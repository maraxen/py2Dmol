"""R5 in a REAL browser: a plugin's Style-panel rows and its legend, in all three shells.

    PY2DMOL_CHROME=/path/to/chrome python3 tests/plugin_rows_browser.py
    PLUGIN_STRUCTURE=/path/to/file.pdb ...      # default: a synthetic helix
    PLUGIN_SHOTS=/some/dir ...                  # where the screenshots go

tests/plugin_rows.js is the same claim against a fake DOM; this is the half that needs layout and
pixels. The plugin here is a small test plugin (two wireframe cubes with rows() and legend()), so
the core's hooks are measured on their own.

THE THREE SHELLS are the notebook (py2Dmol/resources/viewer.html, a page written by the Python API),
the web app (index.html and the web bundle) and the embed (py2Dmol.show with controls). parts/panel.js
is one copy and each shell mounts it, so each is asked the same questions:

  * a viewer WITHOUT plugin rows has the panel it always had, BYTE FOR BYTE: its #stylePanel markup
    is identical before and after a plugin is registered that it has no payload for, and has no
    plugin group and no legend element;
  * a viewer WITH rows gets ONE labelled group inside #stylePanel (a toggle per cube, a slider),
    visible when the panel is opened, and ONE legend element inside the viewer's own box, with a
    swatch per entry;
  * clicking a row's checkbox changes the DRAWING (the magenta wireframe's pixels go to zero and
    come back), the legend loses and regains the entry, and on the GPU the mesh is rebuilt;
  * the slider writes its option (and thickens the line);
  * the legend option takes the legend away;
  * (notebook) a PNG capture carries the legend and an SVG capture carries its text; the legend on
    screen is NOT in the capture twice.
"""
import json
import math
import os
import re
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import plugin_browser as B  # noqa: E402
import cdp  # noqa: E402

ROOT = B.ROOT
py2Dmol = B.py2Dmol
ok = B.ok
ev = B.ev
RED, count = B.RED, B.count
# the cube's own green, exactly: the cartoon's rainbow has plenty of other greens
GREEN = lambda r, g, b: r < 25 and 185 < g < 215 and b < 25
MIN_WIRE_PX = B.MIN_WIRE_PX

PLUGIN_JS = r"""
(function () {
  var P = window.py2dmolPlugins = window.py2dmolPlugins || {list: [], pending: []};
  function cube(c, o, h, color) {
    for (var i = 0; i < 8; i++) for (var b = 1; b < 8; b <<= 1) {
      if (i & b) continue;
      var j = i | b;
      var A = [o[0] + ((i & 1) ? h : -h), o[1] + ((i & 2) ? h : -h), o[2] + ((i & 4) ? h : -h)];
      var B = [o[0] + ((j & 1) ? h : -h), o[1] + ((j & 2) ? h : -h), o[2] + ((j & 4) ? h : -h)];
      c.line(A, B, {color: color, width: c.options.width});
    }
  }
  var def = {
    name: 'rowsdemo', title: 'Demo shells', version: '1', apiVersion: 1,
    options: {showA: true, showB: true, width: 0.45, legend: true},
    key: function (c) { return JSON.stringify(c.options); },
    bounds: function (c) {
      var q = c.payloads[0] && c.payloads[0].payload; if (!q) return null;
      var o = q.center, h = q.half;
      return {min: [o[0] - h, o[1] - h, o[2] - h], max: [o[0] + h, o[1] + h, o[2] + h]};
    },
    prims: function (c) {
      var q = c.payloads[0] && c.payloads[0].payload; if (!q) return;
      if (c.options.showA) cube(c, q.center, q.half, [255, 0, 255]);
      if (c.options.showB) cube(c, q.center, q.half * 0.5, [0, 200, 0]);
    },
    rows: function (c) {
      return [
        [{kind: 'toggle', option: 'showA', label: 'Cube A', checked: !!c.options.showA}],
        [{kind: 'toggle', option: 'showB', label: 'Cube B', checked: !!c.options.showB}],
        [{kind: 'range', option: 'width', label: 'Width', half: true, min: 0.1, max: 1, step: 0.05,
          value: c.options.width}],
      ];
    },
    legend: function (c) {
      var out = [];
      if (c.options.showA) out.push({label: 'Cube A', color: '#ff00ff', note: 'outer'});
      if (c.options.showB) out.push({label: 'Cube B', color: '#00c800'});
      return out;
    }
  };
  if (P.register) P.register(def); else P.pending.push(def);
})();
"""

R = "Object.values(window.py2dmol_viewers)[0].renderer"
PANEL_HTML = "(() => { const p = document.querySelector('#stylePanel'); return p ? p.outerHTML : null; })()"
GROUP = "document.querySelectorAll('#stylePanel [data-py2dmol-plugin-rows]').length"
BOXES = ("Array.from(document.querySelectorAll('#stylePanel [data-py2dmol-plugin-rows] input[type=checkbox]'))")
LEGENDS = "document.querySelectorAll('[data-py2dmol-plugin-legend]').length"
SWATCHES = "document.querySelectorAll('[data-py2dmol-plugin-legend] [data-swatch]').length"
UI = "window.py2dmolPlugins.uiState(%s)" % R
SETOPT = "window.py2dmolPlugins.setOption(" + R + ", 'rowsdemo', %s, %s)"


def settle(ws):
    ev(ws, B.SETTLE)


def px(ws, tag, name):
    """The canvas, wherever the shell puts it (the notebook's controls and the web app's
    columns move it; plugin_browser's own shot() assumes it sits at 8, 8)."""
    import base64
    x, y, w, h = canvas_rect(ws)
    r = ws.call('Page.captureScreenshot', format='png', clip=dict(x=x, y=y, width=w, height=h, scale=1))
    data = base64.b64decode(r['data'])
    open(os.path.join(B.OUT, name + '.png'), 'wb').write(data)
    return data


def open_style_panel(ws):
    ev(ws, "(() => { const p = document.querySelector('#stylePanel'); if (p && p.hidden) document.querySelector('#styleToggle').click(); })()", False)
    time.sleep(0.3)


def full_shot(ws, name):
    r = ws.call('Page.captureScreenshot', format='png')
    import base64
    data = base64.b64decode(r['data'])
    open(os.path.join(B.OUT, name + '.png'), 'wb').write(data)
    return data


def payload_args(tmp):
    path = B.structure_file(tmp)
    return path, {'center': B.centre_of(path), 'half': 12}


def notebook_page(tmp, bundle, gpu, with_payload):
    path, pl = payload_args(tmp)
    v = py2Dmol.view(size=(B.SIZE, B.SIZE), style='cartoon', gpu=bool(gpu), controls=True,
                     preset='richardson', id='rows%d%d' % (gpu, int(with_payload)))
    old, sys.stdout = sys.stdout, open(os.devnull, 'w')
    try:
        v.add_pdb(path, name='obj')
    finally:
        sys.stdout = old
    if with_payload:
        py2Dmol.register_plugin('rowsdemo', PLUGIN_JS, '1')
        v.add_plugin('rowsdemo', pl, object='obj')
    page = os.path.join(tmp, 'rows_nb_%d_%d.html' % (gpu, int(with_payload)))
    open(page, 'w').write(v.to_html(bundle='file://' + bundle))
    return page


def web_page(tmp):
    src = open(os.path.join(ROOT, 'index.html')).read()
    src = re.sub(r'<script src="https://[^"]*jszip[^"]*"></script>', '', src)   # no network needed
    src = re.sub(r'(<script src=")(?!https?:)([^"]+)(")',
                 lambda m: m.group(1) + 'file://' + ROOT + '/' + m.group(2) + m.group(3), src)
    # ...and the page's own stylesheet, so the panel is laid out as the website lays it out
    src = re.sub(r'(<link rel="stylesheet" href=")(?!https?:)([^"]+)(")',
                 lambda m: m.group(1) + 'file://' + ROOT + '/' + m.group(2) + m.group(3), src)
    page = os.path.join(tmp, 'rows_web.html')
    open(page, 'w').write(src)
    return page


def embed_page(tmp):
    path, _ = payload_args(tmp)
    page = os.path.join(tmp, 'rows_embed.html')
    open(page, 'w').write("""<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:8px">
<div id="host" style="width:%dpx;height:%dpx"></div>
<script src="file://%s/py2Dmol/resources/bundles/py2Dmol.embed.min.js"></script>
<script>window.V = py2Dmol.show('host', %s, {controls: true, width: %d, height: %d, style: 'richardson'});</script>
</body></html>""" % (B.SIZE, B.SIZE, ROOT, json.dumps(open(path).read()), B.SIZE, B.SIZE))
    return page


def load_into_web(ws, tmp):
    path, _ = payload_args(tmp)
    ev(ws, "window.processFiles([{name: 'x.pdb', readAsync: () => Promise.resolve(%s)}], false)" % json.dumps(open(path).read()))
    cdp.wait_for(ws, "window.py2dmol_viewers && Object.values(window.py2dmol_viewers)[0] && "
                     "Object.values(window.py2dmol_viewers)[0].renderer.coords.length > 0", 45, 'web structure')
    time.sleep(1.0)


def ready(ws, page):
    ws.call('Page.enable')
    ws.call('Runtime.enable')
    ws.call('Emulation.setDeviceMetricsOverride', width=1300, height=1150, deviceScaleFactor=1, mobile=False)
    ws.call('Page.navigate', url='file://' + page)
    cdp.wait_for(ws, "!!(window.py2dmol_viewers && Object.values(window.py2dmol_viewers)[0]"
                     " && Object.values(window.py2dmol_viewers)[0].renderer)", 45, 'renderer')
    # a direct-present GPU canvas cannot be screenshotted; plugin_browser's open_page does the same
    ev(ws, "(window.py2dmolCartoonGPU && window.py2dmolCartoonGPU.setDirectPresent) ? window.py2dmolCartoonGPU.setDirectPresent(false) : 0", False)
    time.sleep(1.5)


def canvas_rect(ws):
    return ev(ws, "(() => { const r = %s; const b = r.canvas.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()" % R, False)


def exercise(ws, shell, gpu, tmp, payload_via_js):
    tag = '%s-%s' % (shell, 'gpu' if gpu else '2d')
    path, pl = payload_args(tmp)
    # ---- a plugin that is registered but that this viewer has no payload for: the panel is untouched
    open_style_panel(ws)
    h0 = ev(ws, PANEL_HTML, False)
    ok(h0 is not None and 'styleSelect' in h0, '[%s] the Style panel is there (%d chars of markup)' % (tag, len(h0 or '')))
    if payload_via_js:
        ev(ws, PLUGIN_JS, False)                       # registered LATE; the viewer has no payload for it
        settle(ws)
        h1 = ev(ws, PANEL_HTML, False)
        ok(h1 == h0 and ev(ws, GROUP, False) == 0 and ev(ws, LEGENDS, False) == 0,
           '[%s] a plugin registered that this viewer has no payload for: the panel is BYTE-IDENTICAL and there is no group and no legend' % tag)
        ev(ws, "window.py2dmolPlugins.setPayload(%s, 'rowsdemo', {version: '1', apiVersion: 1, options: {},"
               " payloads: [{object: null, frame: null, payload: %s}]})" % (R, json.dumps(pl)), False)
    settle(ws)
    open_style_panel(ws)
    ok(ev(ws, 'window.py2dmolPlugins.errors(%s).length' % R, False) == 0, '[%s] no plugin error' % tag)

    # ---- the rows
    ok(ev(ws, GROUP, False) == 1, '[%s] ONE plugin group inside #stylePanel' % tag)
    info = ev(ws, """(() => { const g = document.querySelector('#stylePanel [data-py2dmol-plugin-rows]');
        const b = g.getBoundingClientRect(); const panel = document.querySelector('#stylePanel');
        return {text: g.textContent, w: b.width, h: b.height, boxes: g.querySelectorAll('input[type=checkbox]').length,
                ranges: g.querySelectorAll('input[type=range]').length, last: panel.lastElementChild === g,
                checked: Array.from(g.querySelectorAll('input[type=checkbox]')).map(x => x.checked)}; })()""", False)
    ok('Demo shells' in info['text'] and 'Cube A' in info['text'] and 'Cube B' in info['text'] and 'Width' in info['text'],
       '[%s] it is labelled "Demo shells" and carries a row per control: "%s"' % (tag, info['text']))
    ok(info['boxes'] == 2 and info['ranges'] == 1 and info['checked'] == [True, True],
       '[%s] two toggles (both checked) and a slider' % tag)
    ok(info['w'] > 60 and info['h'] > 40, '[%s] the group is laid out and visible when the panel is open (%.0f x %.0f px)' % (tag, info['w'], info['h']))
    full_shot(ws, tag + '_panel')

    # ---- the drawing and the legend
    box = px(ws, tag, tag + '_on')
    a_on, b_on = count(box, RED), count(box, GREEN)
    ok(a_on >= MIN_WIRE_PX and b_on > 200, '[%s] both cubes are drawn (magenta %d px, green %d px)' % (tag, a_on, b_on))
    ok(ev(ws, LEGENDS, False) == 1 and ev(ws, SWATCHES, False) == 2, '[%s] ONE legend with a swatch per entry' % tag)
    lg = ev(ws, """(() => { const r = %s; const c = r.canvas.getBoundingClientRect();
        const l = document.querySelector('[data-py2dmol-plugin-legend]'); const b = l.getBoundingClientRect();
        return {inside: b.left >= c.left - 1 && b.top >= c.top - 1 && b.right <= c.right + 1 && b.bottom <= c.bottom + 1,
                w: b.width, h: b.height, text: l.textContent, within: r.canvas.parentElement.contains(l)}; })()""" % R, False)
    ok(lg['inside'] and lg['within'] and lg['w'] > 40 and lg['h'] > 20,
       '[%s] it is INSIDE the viewer\'s own box and the canvas (%.0f x %.0f px): "%s"' % (tag, lg['w'], lg['h'], lg['text']))
    ok('Cube A' in lg['text'] and 'outer' in lg['text'] and 'Cube B' in lg['text'], '[%s] with labels and the note' % tag)
    n_el = ev(ws, "document.querySelectorAll('[data-py2dmol-plugin-legend]').length + document.querySelectorAll('[data-py2dmol-plugin-error]').length", False)
    ok(n_el == 1, '[%s] the legend is the only element the registry added (%d)' % (tag, n_el))

    # ---- a row's checkbox changes the drawing
    b0 = B.builds(ws)
    ev(ws, BOXES + "[0].click()", False)
    settle(ws)
    off = px(ws, tag, tag + '_A_off')
    ok(count(off, RED) == 0 and count(off, GREEN) > 200,
       '[%s] clicking "Cube A" hides the magenta cube (%d px) and leaves the green (%d px)' % (tag, count(off, RED), count(off, GREEN)))
    ok(ev(ws, SWATCHES, False) == 1 and ev(ws, UI + '.groups[0].rows[0][0].checked', False) is False,
       '[%s] the legend loses the entry and the row reports unchecked' % tag)
    if gpu:
        ok(B.builds(ws) > b0, '[%s] ...through a GPU mesh rebuild (__faceBuilds %s -> %s)' % (tag, b0, B.builds(ws)))
    ev(ws, BOXES + "[0].click()", False)
    settle(ws)
    back = px(ws, tag, tag + '_A_on_again')
    ok(count(back, RED) >= MIN_WIRE_PX and ev(ws, SWATCHES, False) == 2,
       '[%s] clicking again brings it back (%d px), and its legend entry' % (tag, count(back, RED)))
    ev(ws, BOXES + "[1].click()", False)
    settle(ws)
    b_off = px(ws, tag, tag + '_B_off')
    ok(count(b_off, GREEN) == 0, '[%s] "Cube B" hides the green cube (%d green px left)' % (tag, count(b_off, GREEN)))
    ev(ws, BOXES + "[1].click()", False)
    settle(ws)

    # ---- the slider writes its option and thickens the line
    thin = count(px(ws, tag, tag + '_thin'), RED)
    ev(ws, """(() => { const s = document.querySelector('#stylePanel [data-py2dmol-plugin-rows] input[type=range]');
        s.value = '1'; s.dispatchEvent(new Event('change', {bubbles: true})); })()""", False)
    settle(ws)
    thick = count(px(ws, tag, tag + '_thick'), RED)
    ok(ev(ws, UI + '.groups[0].rows[2][0].value', False) == 1 and thick > thin * 1.3,
       '[%s] the slider sets "width" to 1 and the wireframe thickens (%d -> %d px)' % (tag, thin, thick))

    # ---- the legend option
    ev(ws, SETOPT % ("'legend'", 'false'), False)
    settle(ws)
    ok(ev(ws, LEGENDS, False) == 0, '[%s] the legend option (false) removes the legend element' % tag)
    ev(ws, SETOPT % ("'legend'", 'true'), False)
    settle(ws)
    ok(ev(ws, LEGENDS, False) == 1, '[%s] ...and true puts it back' % tag)

    # ---- capture (notebook only: it has the capture API on a bare page)
    if shell == 'notebook':
        png = B.png_capture(ws)
        open(os.path.join(B.OUT, tag + '_capture.png'), 'wb').write(png)
        ev(ws, SETOPT % ("'legend'", 'false'), False)
        settle(ws)
        bare = B.png_capture(ws)
        d = B.differ(png, bare)
        ok(d > 150, '[%s] a PNG capture carries the legend: %d px differ from the capture with the legend off' % (tag, d))
        if not gpu:
            ev(ws, SETOPT % ("'legend'", 'true'), False)
            settle(ws)
            svg = ev(ws, "%s.toImage({format:'svg'}).then(o=>o.text)" % R)
            open(os.path.join(B.OUT, tag + '_capture.svg'), 'w').write(svg)
            ok('Cube A' in svg and 'Cube B' in svg and 'outer' in svg, '[%s] an SVG capture carries the legend text' % tag)
            ev(ws, SETOPT % ("'legend'", 'false'), False)
            settle(ws)
            svg2 = ev(ws, "%s.toImage({format:'svg'}).then(o=>o.text)" % R)
            ok('Cube A' not in svg2, '[%s] ...and not when the legend is off' % tag)


def main():
    tmp = tempfile.mkdtemp()
    bundle, which = B.bundle_path(tmp)
    print('bundle:', which, '\nshots in', B.OUT, flush=True)
    proc, ws = B.launch(9334)
    try:
        # ---- NOTEBOOK shell: a page written by the Python API, both painters
        for gpu in (0, 1):
            ready(ws, notebook_page(tmp, bundle, gpu, True))
            exercise(ws, 'notebook', gpu, tmp, payload_via_js=False)
        # ---- the same page, plugin registered LATE with no payload: nothing changes
        ready(ws, notebook_page(tmp, bundle, 0, False))
        exercise(ws, 'notebook-late', 0, tmp, payload_via_js=True)
        # ---- WEB shell
        ready(ws, web_page(tmp))
        load_into_web(ws, tmp)
        exercise(ws, 'web', 0, tmp, payload_via_js=True)
        # ---- EMBED shell
        ready(ws, embed_page(tmp))
        time.sleep(1.0)
        exercise(ws, 'embed', 0, tmp, payload_via_js=True)
    finally:
        proc.kill()
    print('plugin rows browser probe:', 'FAILED %d' % B.bad if B.bad else 'ok')
    sys.exit(1 if B.bad else 0)


if __name__ == '__main__':
    main()
