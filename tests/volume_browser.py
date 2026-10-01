"""The `volume` plugin in a REAL browser, on two structures, in both painters.

    PY2DMOL_CHROME=/path/to/chrome python3 tests/volume_browser.py
    PLUGIN_STRUCTURE=/path/to/file.pdb ...      # ONE structure instead of the default two
    PLUGIN_1CRN=/path/to/1CRN.pdb ...           # the second default structure (else: SKIP, the helix alone)
    PLUGIN_SHOTS=/some/dir ...                  # where the screenshots go

The structures: a synthetic 60-residue helix (88 A long, 2.3 A across) and 1CRN (a PDB file the
repo does not carry: PLUGIN_1CRN names it, and without it a SKIP line says so and the helix runs
alone). Around each, a synthetic dG-LIKE field: two Gaussian wells at known
positions (one per probe group), cut by py2Dmol.volume.meshes_from_grid at two negative levels
each, so the whole chain is measured - field -> marching cubes -> view.add_volume -> page ->
registry -> plugin -> prims -> painter -> pixels:

  * the wireframe is drawn in BOTH painters, in the probe colours (pixel counts, with a floor so a
    picture that is technically present and practically invisible cannot pass);
  * the fit INCLUDES the shells (nothing cropped at the canvas edge) and is not over-zoomed;
  * a PNG capture has the shells and the legend; an SVG capture has the legend's text;
  * the Style panel has a row per group, a Style select, an Edges slider and a Legend toggle; clicking
    a group's row hides that group's pixels and its legend entries, and clicking again brings them
    back (on the GPU through a mesh rebuild);
  * style "solid" draws opaque triangles (many more pixels than the wire);
  * a rotation keeps the shells with NO GPU mesh rebuild;
  * the legend is inside the viewer's box, grouped, one swatch per visible mesh;
  * an over-budget mesh (a 30,720-edge icosphere) is SUBSAMPLED, not refused: no error state, the
    legend note says "shown N of 30,720 edges", and the Edges slider changes N;
  * save_state -> load_state -> a new page draws the same picture, with no add_volume call.
"""
import math
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import plugin_browser as B  # noqa: E402
import plugin_rows_browser as RB  # noqa: E402
import cdp  # noqa: E402

import numpy as np  # noqa: E402
py2Dmol = B.py2Dmol
from py2Dmol import volume as VOL  # noqa: E402

ok, ev, count = B.ok, B.ev, B.count
# The floor is stated once, so no check below passes on a picture that is technically present
# and practically invisible (the baseline has NONE of these colours). It is lower than the core
# probe's 1,000 because a shell is a SUBSAMPLED mesh of 1-pixel wires, not a cube of thick ones: on
# the 2D painter each mesh shows 1,800 edges, and the sparser probe measures ~700 px on the helix.
MIN_WIRE_PX = 500
R = RB.R
MAGENTA = lambda r, g, b: r > 200 and b > 200 and g < 90                 # the ACE probe
GREENS = lambda r, g, b: r < 25 and 185 < g < 215 and b < 25             # the NMA probe
SHOTS = os.environ.get('PLUGIN_SHOTS', B.OUT)

FIXTURE_1CRN = os.environ.get('PLUGIN_1CRN', '')


def helix_file(tmp):
    path = os.path.join(tmp, 'helix.pdb')
    lines = []
    for i in range(60):
        th = i * 100 * math.pi / 180
        lines.append('ATOM  %5d  CA  ALA A%4d    %8.3f%8.3f%8.3f  1.00 50.00           C'
                     % (i + 1, i + 1, 2.3 * math.cos(th), 2.3 * math.sin(th), 1.5 * i))
    open(path, 'w').write('\n'.join(lines) + '\nEND\n')
    return path


def structures(tmp):
    given = os.environ.get('PLUGIN_STRUCTURE')
    if given:
        return [(os.path.basename(given), given)]
    out = [('helix', helix_file(tmp))]
    if FIXTURE_1CRN and os.path.exists(FIXTURE_1CRN):
        out.append(('1CRN', FIXTURE_1CRN))
    else:
        print('SKIP 1CRN: set PLUGIN_1CRN=/path/to/1CRN.pdb (the helix alone runs)')
    return out


def well_meshes(centre, sigma, depth, levels, labels, colors, group, spacing):
    """A dG-LIKE well: f = -depth * exp(-r^2 / 2 sigma^2) on its own grid, cut at NEGATIVE levels
    (each surface encloses the voxels BELOW the level)."""
    half = sigma * math.sqrt(2 * math.log(depth / abs(min(levels)))) + 4.0
    n = int(2 * half / spacing) + 1
    origin = np.asarray(centre, float) - half
    ax = [origin[i] + np.arange(n) * spacing for i in range(3)]
    X, Y, Z = np.meshgrid(*ax, indexing='ij')
    f = -depth * np.exp(-((X - centre[0]) ** 2 + (Y - centre[1]) ** 2 + (Z - centre[2]) ** 2) / (2 * sigma ** 2))
    return VOL.meshes_from_grid(f, origin, spacing, levels, labels=labels, colors=colors, group=group)


def probe_meshes(name, centre):
    """Two wells around the structure at known offsets, ACE (magenta) and NMA (green)."""
    if name == 'helix':
        sigma, sp, off1, off2, lv = 7.0, 0.9, (9.0, 0.0, 18.0), (-9.0, 0.0, -18.0), (-0.6, -1.6)
    else:
        sigma, sp, off1, off2, lv = 3.2, 0.5, (9.0, 2.0, 4.0), (-9.0, -3.0, -5.0), (-0.6, -1.6)
    c1 = [centre[i] + off1[i] for i in range(3)]
    c2 = [centre[i] + off2[i] for i in range(3)]
    ace = well_meshes(c1, sigma, 3.0, lv, ['ACE %g' % x for x in lv], ['#ff00ff', '#d000d0'], 'ACE', sp)
    nma = well_meshes(c2, sigma, 3.0, lv, ['NMA %g' % x for x in lv], ['#00c800', '#00be00'], 'NMA', sp)
    return ace + nma, (c1, c2)


def icosphere(subdiv, r, centre):
    t = (1 + math.sqrt(5)) / 2
    V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
         [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
         [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
         [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    for _ in range(subdiv):
        mid, nf = {}, []

        def get(a, b):
            k = (min(a, b), max(a, b))
            if k not in mid:
                V.append([(V[a][i] + V[b][i]) / 2 for i in range(3)])
                mid[k] = len(V) - 1
            return mid[k]
        for a, b, c in F:
            ab, bc, ca = get(a, b), get(b, c), get(c, a)
            nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        F = nf
    V = np.array(V, float)
    V = V / np.linalg.norm(V, axis=1)[:, None] * r + np.asarray(centre)
    return V, np.array(F, np.int32)


def make_view(tmp, path, gpu, ident, meshes=None, preset='richardson', **kw):
    v = py2Dmol.view(size=(B.SIZE, B.SIZE), style='cartoon', gpu=bool(gpu), controls=True,
                     preset=preset, id=ident)
    old, sys.stdout = sys.stdout, open(os.devnull, 'w')
    try:
        v.add_pdb(path, name='obj')
    finally:
        sys.stdout = old
    if meshes is not None:
        v.add_volume(meshes, **kw)
    return v


def page_of(tmp, v, bundle, name):
    p = os.path.join(tmp, name + '.html')
    open(p, 'w').write(v.to_html(bundle='file://' + bundle))
    return p


UI = "window.py2dmolPlugins.uiState(%s)" % R
LEGEND_TEXT = "(() => { const l = document.querySelector('[data-py2dmol-plugin-legend]'); return l ? l.textContent : null; })()"
ROWS = "Array.from(document.querySelectorAll('#stylePanel [data-py2dmol-plugin-rows] label.btn-toggle'))"
SEL = "document.querySelector('#stylePanel [data-py2dmol-plugin-rows] select')"
RANGE = "document.querySelector('#stylePanel [data-py2dmol-plugin-rows] input[type=range]')"
ERRBADGE = "document.querySelectorAll('[data-py2dmol-plugin-error]').length"


def row_input(label):
    return ("(() => { const l = %s.find(x => x.textContent.trim() === %r); return l ? l.querySelector('input') : null; })()"
            % (ROWS, label))


def click_row(ws, label):
    return ev(ws, "(() => { const i = %s; if (i) i.click(); return !!i; })()" % row_input(label), False)


def set_select(ws, value):
    ev(ws, "(() => { const s = %s; s.value = %r; s.dispatchEvent(new Event('change', {bubbles: true})); })()" % (SEL, value), False)


def set_range(ws, value):
    ev(ws, "(() => { const s = %s; s.value = %r; s.dispatchEvent(new Event('change', {bubbles: true})); })()" % (RANGE, str(value)), False)


def edge_px(data, pred, m=3):
    w, h, rows = B.png_rgb(data)
    n = 0
    for y in range(h):
        for x in range(w):
            if (x < m or y < m or x >= w - m or y >= h - m) and pred(rows[y][3 * x], rows[y][3 * x + 1], rows[y][3 * x + 2]):
                n += 1
    return n


def run_structure(ws, tmp, bundle, name, path):
    centre = B.centre_of(path)
    meshes, wells = probe_meshes(name, centre)
    ids = [m['id'] for m in meshes]
    ok(len(meshes) == 4 and ids == ['ACE:ACE -0.6', 'ACE:ACE -1.6', 'NMA:NMA -0.6', 'NMA:NMA -1.6'],
       '[%s] meshes_from_grid made four shells from two wells: %s (%s faces)'
       % (name, ids, [len(m['faces']) for m in meshes]))
    # the wells are where they were put, to within a voxel: the sign convention measured end to end
    for m, w in ((meshes[0], wells[0]), (meshes[2], wells[1])):
        c = m['vertices'].mean(axis=0)
        ok(np.abs(c - np.array(w)).max() < 1.0, '[%s] the %s shell is centred on its well to within a voxel (off by %.2f A)'
           % (name, m['group'], np.abs(c - np.array(w)).max()))
    verts = np.vstack([m['vertices'] for m in meshes])
    cen = np.array(centre)
    shell_r = float(np.linalg.norm(verts - cen, axis=1).max())          # farthest shell point from the structure
    struct_r = None
    for gpu in (0, 1):
        tag = '%s-%s' % (name, 'gpu' if gpu else '2d')
        # ---------------------------------------------- baseline
        RB.ready(ws, page_of(tmp, make_view(tmp, path, gpu, 'vb%s%d' % (name, gpu)), bundle, 'base_' + tag))
        RB.settle(ws)
        base = RB.px(ws, tag, tag + '_baseline')
        ok(count(base, MAGENTA) == 0 and count(base, GREENS) == 0, '[%s] baseline: none of the probe colours on screen' % tag)
        bx, by = ev(ws, B.SPAN2, False)
        # ---------------------------------------------- the volume, through the Python API
        v = make_view(tmp, path, gpu, 'vv%s%d' % (name, gpu), meshes)
        RB.ready(ws, page_of(tmp, v, bundle, 'vol_' + tag))
        RB.settle(ws)
        RB.open_style_panel(ws)
        RB.settle(ws)
        on = RB.px(ws, tag, tag + '_wire')
        mag, grn = count(on, MAGENTA), count(on, GREENS)
        ok(mag >= MIN_WIRE_PX and grn >= MIN_WIRE_PX,
           '[%s] both probes draw as wireframe: ACE %d px, NMA %d px (floor %d)' % (tag, mag, grn, MIN_WIRE_PX))
        ok(ev(ws, 'window.py2dmolPlugins.errors(%s).length' % R, False) == 0 and ev(ws, ERRBADGE, False) == 0, '[%s] no plugin error' % tag)
        used_gpu = ev(ws, R + '.useGPU', False)
        ok(bool(used_gpu) == bool(gpu), '[%s] the painter under test is the one asked for (useGPU=%s)' % (tag, used_gpu))
        # ---- the fit INCLUDES the shells and is not over-zoomed
        fx, fy = ev(ws, B.SPAN2, False)
        ok(edge_px(on, MAGENTA) == 0 and edge_px(on, GREENS) == 0, '[%s] the fit includes the shells: nothing is cropped at the canvas edge' % tag)
        cap_hi = 1.35 * max(shell_r, bx, by)
        ok(max(fx, fy) >= shell_r and max(fx, fy) <= cap_hi,
           '[%s] and is not over-zoomed: half-span %.1f x %.1f A, between the farthest shell point (%.1f A from the centre) and 1.35 x max(that, structure alone %.1f x %.1f) = %.1f'
           % (tag, fx, fy, shell_r, bx, by, cap_hi))
        # ---- the legend
        leg = ev(ws, LEGEND_TEXT, False)
        ok(leg is not None and all(s in leg for s in ('ACE', 'NMA', 'ACE -0.6', 'ACE -1.6', 'NMA -0.6', 'NMA -1.6')),
           '[%s] the legend lists the four shells under their two groups: "%s"' % (tag, leg))
        ok(ev(ws, RB.SWATCHES, False) == 4 and ev(ws, RB.LEGENDS, False) == 1, '[%s] ONE legend, four swatches' % tag)
        ok(ev(ws, "(() => { const r = %s; const l = document.querySelector('[data-py2dmol-plugin-legend]');"
                  " return r.canvas.parentElement.contains(l); })()" % R, False) is True,
           '[%s] it is inside the viewer\'s own box' % tag)
        # ---- the panel
        info = ev(ws, """(() => { const g = document.querySelector('#stylePanel [data-py2dmol-plugin-rows]');
            return g ? {text: g.textContent, toggles: Array.from(g.querySelectorAll('label.btn-toggle')).map(x => x.textContent.trim()),
                        selects: g.querySelectorAll('select').length, ranges: g.querySelectorAll('input[type=range]').length,
                        h: g.getBoundingClientRect().height} : null; })()""", False)
        ok(info is not None and info['toggles'] == ['ACE', 'NMA', 'Legend'] and info['selects'] == 1 and info['ranges'] == 1 and 'Volume' in info['text'] and info['h'] > 60,
           '[%s] the Style panel has a "Volume" group: rows %s, a Style select and an Edges slider' % (tag, info and info['toggles']))
        RB.full_shot(ws, tag + '_panel')
        # ---- rows change the drawing
        b0 = B.builds(ws)
        ok(click_row(ws, 'ACE'), '[%s] the ACE row exists' % tag)
        RB.settle(ws)
        off = RB.px(ws, tag, tag + '_ace_off')
        ok(count(off, MAGENTA) == 0 and count(off, GREENS) >= 0.9 * grn,
           '[%s] clicking ACE hides the ACE shells (%d px) and leaves NMA (%d px)' % (tag, count(off, MAGENTA), count(off, GREENS)))
        leg2 = ev(ws, LEGEND_TEXT, False)
        ok('ACE' not in leg2 and 'NMA -1.6' in leg2 and ev(ws, RB.SWATCHES, False) == 2, '[%s] ...and the legend loses both ACE entries and the heading' % tag)
        if gpu:
            ok(B.builds(ws) > b0, '[%s] ...through a GPU mesh rebuild (__faceBuilds %s -> %s)' % (tag, b0, B.builds(ws)))
        click_row(ws, 'ACE')
        RB.settle(ws)
        ok(count(RB.px(ws, tag, tag + '_ace_on'), MAGENTA) >= MIN_WIRE_PX, '[%s] ...and clicking again brings ACE back' % tag)
        click_row(ws, 'NMA')
        RB.settle(ws)
        ok(count(RB.px(ws, tag, tag + '_nma_off'), GREENS) == 0, '[%s] clicking NMA hides the NMA shells' % tag)
        click_row(ws, 'NMA')
        RB.settle(ws)
        # ---- rotation: still there, no rebuild
        b1 = B.builds(ws)
        B.rotate(ws, 0.9)
        rot = RB.px(ws, tag, tag + '_rot')
        ok(count(rot, MAGENTA) >= MIN_WIRE_PX and count(rot, GREENS) >= MIN_WIRE_PX and rot != on,
           '[%s] after a rotation both probes are still there and have moved' % tag)
        if gpu:
            ok(B.builds(ws) == b1, '[%s] ...with NO mesh rebuild (__faceBuilds %s -> %s)' % (tag, b1, B.builds(ws)))
        B.rotate(ws, -0.9)
        # ---- capture: PNG has the shells and the legend, SVG has the legend text
        png = B.png_capture(ws)
        open(os.path.join(SHOTS, tag + '_capture.png'), 'wb').write(png)
        ok(count(png, MAGENTA) >= MIN_WIRE_PX and count(png, GREENS) >= MIN_WIRE_PX, '[%s] a PNG capture has the shells (%d + %d px)' % (tag, count(png, MAGENTA), count(png, GREENS)))
        ev(ws, "window.py2dmolPlugins.setOption(%s, 'volume', 'legend', false)" % R, False)
        RB.settle(ws)
        nolegend = B.png_capture(ws)
        d = B.differ(png, nolegend)
        ok(d > 300, '[%s] ...and the legend: %d px differ from the capture with the legend off' % (tag, d))
        ev(ws, "window.py2dmolPlugins.setOption(%s, 'volume', 'legend', true)" % R, False)
        RB.settle(ws)
        if not gpu:
            svg = ev(ws, "%s.toImage({format:'svg'}).then(o=>o.text)" % R)
            open(os.path.join(SHOTS, tag + '_capture.svg'), 'w').write(svg)
            ok('ACE -1.6' in svg and 'NMA -0.6' in svg and svg.count('#ff00ff') > 100,
               '[%s] an SVG capture has the shell strokes and the legend text' % tag)
        # ---- solid
        set_select(ws, 'solid')
        RB.settle(ws)
        sol = RB.px(ws, tag, tag + '_solid')
        sm, sg = count(sol, MAGENTA), count(sol, GREENS)
        ok(ev(ws, UI + '.groups[0].rows.some(r => r.some(i => i.option === "style" && i.value === "solid"))', False)
           and ev(ws, 'window.py2dmolPlugins.errors(%s).length' % R, False) == 0,
           '[%s] the Style select sets "solid" and the panel shows it' % tag)
        # (that the triangles are OPAQUE is measured below, on a page of two nested shells: a dense
        # wire already covers as many pixels as a solid - GPU, 1CRN: 15,928 against 15,960 - so the
        # probe-coloured AREA cannot tell the two styles apart)
        family = lambda r, g, b: (r > 60 and b > 60 and g < 0.6 * min(r, b)) or (g > 60 and r < 0.6 * g and b < 0.6 * g)
        solid_probe = count(sol, family)
        ok(solid_probe > 3000, '[%s] solid style draws: %d px in the probe colours and their lit tones' % (tag, solid_probe))
        RB.full_shot(ws, tag + '_solid_full')
        set_select(ws, 'wire')
        RB.settle(ws)
        ok(count(RB.px(ws, tag, tag + '_wire_again'), MAGENTA) >= MIN_WIRE_PX, '[%s] and back to wire' % tag)
        # ---- save_state -> load_state -> the SAME picture, with no add_volume call.
        # On the grain-free 'ribbon' preset: Richardson's paper grain is re-seeded per page load and
        # moves the pixel count of a 1-px wire by 1-14% between two loads of the SAME page
        # (measured: ACE 3430-3524, NMA 693-799), so a comparison there measures the grain. On
        # 'ribbon' three loads give identical counts, and the comparison is exact.
        vr = make_view(tmp, path, gpu, 'vr%s%d' % (name, gpu), meshes, preset='ribbon')
        RB.ready(ws, page_of(tmp, vr, bundle, 'ribbon_' + tag))
        RB.settle(ws)
        key0 = ev(ws, 'window.py2dmolPlugins.key(%s)' % R, False)
        png0 = B.png_capture(ws)
        st = os.path.join(tmp, 'st_%s.json' % tag)
        old, sys.stdout = sys.stdout, open(os.devnull, 'w')
        try:
            vr.save_state(st)
        finally:
            sys.stdout = old
        w = py2Dmol.view(size=(B.SIZE, B.SIZE), style='cartoon', gpu=bool(gpu), controls=True, preset='ribbon', id='vr%s%d' % (name, gpu))
        old, sys.stdout = sys.stdout, open(os.devnull, 'w')
        try:
            w.load_state(st)
        finally:
            sys.stdout = old
        RB.ready(ws, page_of(tmp, w, bundle, 'loaded_' + tag))
        RB.settle(ws)
        RB.px(ws, tag, tag + '_loaded')
        png1 = B.png_capture(ws)
        m0, g0, m2, g2 = count(png0, MAGENTA), count(png0, GREENS), count(png1, MAGENTA), count(png1, GREENS)
        ok(m0 >= MIN_WIRE_PX and g0 >= MIN_WIRE_PX and m2 == m0 and g2 == g0,
           '[%s] save_state -> load_state -> a new page (no add_volume call in it) draws the SAME picture (capture: ACE %d vs %d, NMA %d vs %d)'
           % (tag, m2, m0, g2, g0))
        key1 = ev(ws, 'window.py2dmolPlugins.key(%s)' % R, False)
        ok(key1 == key0 and key0, '[%s] ...and the registry key is the same string (%d chars)' % (tag, len(key0 or '')))

        # ---------------------------------------------- an OVER-BUDGET mesh: subsampled, not refused
        V30, F30 = icosphere(5, 0.45 * shell_r, centre)
        big = [{'id': 'big', 'label': 'Big shell', 'group': None, 'level': -0.5, 'color': '#ff00ff',
                'vertices': V30, 'faces': F30}]
        RB.ready(ws, page_of(tmp, make_view(tmp, path, gpu, 'vo%s%d' % (name, gpu), big), bundle, 'over_' + tag))
        RB.settle(ws)
        RB.open_style_panel(ws)
        note = ev(ws, LEGEND_TEXT, False)
        want = 'shown 10,000 of 30,720 edges' if gpu else 'shown 7,200 of 30,720 edges'
        ok(note is not None and want in note, '[%s] a 30,720-edge mesh: the legend says "%s" (legend: "%s")' % (tag, want, note))
        ok(ev(ws, 'window.py2dmolPlugins.errors(%s).length' % R, False) == 0 and ev(ws, ERRBADGE, False) == 0,
           '[%s] ...and the core\'s cap error is NOT tripped' % tag)
        over = RB.px(ws, tag, tag + '_over')
        ok(count(over, MAGENTA) >= MIN_WIRE_PX, '[%s] ...and the shell is drawn (%d px)' % (tag, count(over, MAGENTA)))
        set_range(ws, 2000)
        RB.settle(ws)
        note2 = ev(ws, LEGEND_TEXT, False)
        ok(note2 is not None and 'shown 2,000 of 30,720 edges' in note2,
           '[%s] the Edges slider changes it: "%s"' % (tag, note2))
        RB.full_shot(ws, tag + '_over_full')
        # an EXPORT's legend says what that export drew: an SVG is always the 2D painter (7,200 edges), a GPU
        # viewer's screen says 10,000 - the first version drew the screen's note into the SVG
        if gpu:
            set_range(ws, 10000)
            RB.settle(ws)
            svg = ev(ws, "%s.toImage({format:'svg'}).then(o=>o.text)" % R)
            ok('shown 7,200 of 30,720 edges' in svg and 'shown 10,000' not in svg,
               '[%s] the legend drawn into an SVG export says 7,200 (what the 2D painter drew), not the screen\'s 10,000' % tag)
            # ...and a PNG at a dpi so high that the GPU DECLINES the frame (measured: 1,500 dpi = 7,475 px) is
            # drawn by the 2D painter under the 2D cap: its legend must follow the painter that drew it
            ev(ws, """(() => { const P = window.py2dmolPlugins; const o = P.drawLegend; window.__lt = []; window.__drew = null;
                if (!o.__wrapped) { P.drawLegend = function (r, ctx, w, h, k) { window.__drew = r.gpuDrewLastFrame; window.__dim = [w, h];
                    const f = ctx.fillText.bind(ctx); ctx.fillText = (t, ...a) => { window.__lt.push(t); return f(t, ...a); };
                    return o.apply(this, arguments); }; P.drawLegend.__wrapped = true; } })()""", False)
            ev(ws, "%s.toImage({format:'png', dpi:1500, transparent:false}).then(o => o.width)" % R)
            drew, said, dim = ev(ws, 'window.__drew', False), ev(ws, 'window.__lt.join(" | ")', False), ev(ws, 'window.__dim', False)
            want = 'shown 10,000 of 30,720' if drew else 'shown 7,200 of 30,720'
            ok(drew is not None and want in said,
               '[%s] a %s px PNG (1,500 dpi) was drawn by the %s painter and its legend says so: "%s"'
               % (tag, dim and dim[0], 'GPU' if drew else '2D (the GPU declined)', said[:60]))
            RB.settle(ws)

        # ---------------------------------------------- OPAQUE: a solid shell hides what is inside it
        # Two NESTED shells, a green one inside a magenta one, small enough that every triangle is
        # drawn on the 2D painter too. As a wire the green is seen through the magenta; as solid
        # triangles the magenta hides it. (A grain-free preset, so the counts are the geometry's.)
        Vo, Fo = icosphere(3, 0.45 * shell_r, centre)
        Vi, Fi = icosphere(3, 0.22 * shell_r, centre)
        nest = [{'id': 'outer', 'label': 'Outer', 'group': None, 'level': -0.5, 'color': '#ff00ff', 'vertices': Vo, 'faces': Fo},
                {'id': 'inner', 'label': 'Inner', 'group': None, 'level': -1.5, 'color': '#00c800', 'vertices': Vi, 'faces': Fi}]
        # (no legend on this page: its green swatch is 100 px of exactly the colour being counted)
        RB.ready(ws, page_of(tmp, make_view(tmp, path, gpu, 'vn%s%d' % (name, gpu), nest, preset='ribbon', legend=False), bundle, 'nest_' + tag))
        RB.settle(ws)
        RB.open_style_panel(ws)
        green_lit = lambda r, g, b: r < 25 and b < 25 and g > 50           # the inner shell, lit or not; no cartoon green is this pure
        wire = RB.px(ws, tag, tag + '_nest_wire')
        g_wire = count(wire, green_lit)
        set_select(ws, 'solid')
        RB.settle(ws)
        solid = RB.px(ws, tag, tag + '_nest_solid')
        g_solid, m_solid = count(solid, green_lit), count(solid, family)
        ok(g_wire >= MIN_WIRE_PX and g_solid <= 0.05 * g_wire + 20 and m_solid > 3000 and
           ev(ws, 'window.py2dmolPlugins.errors(%s).length' % R, False) == 0,
           '[%s] solid triangles are OPAQUE: the inner shell seen through the outer wire (%d px) is hidden by the outer solid (%d px; outer %d px)'
           % (tag, g_wire, g_solid, m_solid))


def main():
    tmp = tempfile.mkdtemp()
    bundle, which = B.bundle_path(tmp)
    print('bundle:', which, '\nshots in', B.OUT, flush=True)
    proc, ws = B.launch(9335)
    try:
        for name, path in structures(tmp):
            print('=== structure', name, flush=True)
            run_structure(ws, tmp, bundle, name, path)
    finally:
        proc.kill()
    print('volume browser probe:', 'FAILED %d' % B.bad if B.bad else 'ok')
    sys.exit(1 if B.bad else 0)


if __name__ == '__main__':
    main()
