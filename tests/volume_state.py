"""The `volume` plugin through the Python side: add_volume, meshes_from_grid, state, the page.

    python3 tests/volume_state.py

WHAT IS CLAIMED (docs/PLUGINS.md, section 12):

  * view.add_volume validates BEFORE it stores: a refusal leaves no half-made entry;
  * the plugin's JavaScript is a packaged resource, inlined once per viewer that has a volume
    payload and for no other, and it passes register_plugin's own refusals;
  * a volume payload round-trips save_state -> load_state -> to_html, and load_state does
    NOT call it an unknown plugin (it ships with py2Dmol);
  * meshes_from_grid on a synthetic field: the radius is recovered to within a voxel, the
    origin and anisotropic spacing are applied, the SIGN CONVENTION holds (the surface
    encloses the voxels BELOW a negative level, normals out), NaN voxels never make surface
    (and leave an open surface, not a wall), a level with no surface is skipped with a
    warning, and scikit-image is imported only when the function is CALLED.

Verified by breaking it: with the NaN mask taken out the "no wall" check fails; with the winding
flipped the sign check fails.
"""
import json
import math
import os
import subprocess
import sys
import tempfile
import types
import warnings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    import IPython.display  # noqa: F401
except ImportError:
    _disp = types.ModuleType('IPython.display')
    for _n in ('display', 'HTML', 'Javascript', 'update_display'):
        setattr(_disp, _n, lambda *a, **k: None)
    _ip = types.ModuleType('IPython')
    _ip.display = _disp
    sys.modules['IPython'] = _ip
    sys.modules['IPython.display'] = _disp
sys.path.insert(0, ROOT)
import numpy as np  # noqa: E402
import py2Dmol  # noqa: E402
from py2Dmol import viewer as V  # noqa: E402
from py2Dmol import volume as VOL  # noqa: E402

assert py2Dmol.__file__.startswith(ROOT), py2Dmol.__file__
bad = 0


def ok(c, msg):
    global bad
    print(('PASS ' if c else 'FAIL ') + msg)
    if not c:
        bad += 1


def raises(exc, fn, *a, **k):
    try:
        fn(*a, **k)
    except exc as e:
        return str(e)
    except Exception as e:  # the wrong kind of failure is not a refusal
        return None if not isinstance(e, exc) else str(e)
    return None


def helix_pdb(path, n=30):
    lines = []
    for i in range(n):
        th = i * 100 * math.pi / 180
        lines.append('ATOM  %5d  CA  ALA A%4d    %8.3f%8.3f%8.3f  1.00 50.00           C'
                     % (i + 1, i + 1, 2.3 * math.cos(th), 2.3 * math.sin(th), 1.5 * i))
    open(path, 'w').write('\n'.join(lines) + '\nEND\n')
    return path


def fresh(tmp, **kw):
    v = py2Dmol.view(style='cartoon', id='fixedid', **kw)
    old, sys.stdout = sys.stdout, open(os.devnull, 'w')
    try:
        v.add_pdb(helix_pdb(os.path.join(tmp, 'h.pdb')), name='crn')
    finally:
        sys.stdout = old
    return v


def cube(mid='c', **over):
    """A cube: 8 vertices, 12 triangles (a diagonal on each face)."""
    verts = [[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)]
    quad = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = []
    for a, b, c, d in quad:
        faces += [[a, b, c], [a, c, d]]
    m = {'id': mid, 'label': 'Cube ' + mid, 'group': None, 'level': -1.0, 'color': '#ff0000',
         'vertices': verts, 'faces': faces}
    m.update(over)
    return m


# ---- validate_meshes -------------------------------------------------------
good = VOL.validate_meshes([cube('a'), cube('b', group='G')])
ok(len(good) == 2 and json.loads(json.dumps(good)) == good, 'a valid payload is returned as plain JSON data')
ok(good[0]['faces'][0] == [0, 1, 3] and isinstance(good[0]['vertices'][0][0], float),
   'faces are ints, vertices floats (lists, not arrays)')
ok(VOL.validate_meshes([cube('a', color='#FF00aa')])[0]['color'] == '#ff00aa', 'colours are lower-cased')
ok(VOL.validate_meshes([dict(cube('a'), vertices=np.array(cube('a')['vertices']),
                             faces=np.array(cube('a')['faces'], dtype=np.int32))]), 'numpy arrays are accepted')
ok(VOL.validate_meshes([cube('a', vertices=[[0.123456789, 0, 0]] + cube('a')['vertices'][1:])])[0]['vertices'][0][0] == 0.1235,
   'coordinates are rounded to 1e-4 A')

bigfaces = [[0, 1, 2]] * 5
CASES = {
    'a dict instead of a list': (TypeError, lambda: VOL.validate_meshes(cube())),
    'a string': (TypeError, lambda: VOL.validate_meshes('mesh')),
    'an empty list': (ValueError, lambda: VOL.validate_meshes([])),
    'a mesh that is not a dict': (TypeError, lambda: VOL.validate_meshes([3])),
    'an unknown key (a typo for color)': (ValueError, lambda: VOL.validate_meshes([dict(cube(), colour='#ff0000')])),
    'no id': (ValueError, lambda: VOL.validate_meshes([{k: v for k, v in cube().items() if k != 'id'}])),
    'an empty id': (ValueError, lambda: VOL.validate_meshes([cube(id='')])),
    'a duplicate id': (ValueError, lambda: VOL.validate_meshes([cube('a'), cube('a')])),
    'a colour that is not #rrggbb': (ValueError, lambda: VOL.validate_meshes([cube(color='red')])),
    'a 3-digit colour': (ValueError, lambda: VOL.validate_meshes([cube(color='#f00')])),
    'a NaN vertex': (ValueError, lambda: VOL.validate_meshes([cube(vertices=[[float('nan'), 0, 0]] + cube()['vertices'][1:])])),
    'an infinite vertex': (ValueError, lambda: VOL.validate_meshes([cube(vertices=[[float('inf'), 0, 0]] + cube()['vertices'][1:])])),
    'vertices of the wrong shape': (ValueError, lambda: VOL.validate_meshes([cube(vertices=[[0, 0]] * 8)])),
    'vertices that are not numbers': (ValueError, lambda: VOL.validate_meshes([cube(vertices=[['a', 'b', 'c']] * 8)])),
    'a face index out of range': (ValueError, lambda: VOL.validate_meshes([cube(faces=[[0, 1, 8]])])),
    'a negative face index': (ValueError, lambda: VOL.validate_meshes([cube(faces=[[0, 1, -1]])])),
    'float face indices': (TypeError, lambda: VOL.validate_meshes([cube(faces=np.array([[0.0, 1.0, 2.0]]))])),
    'no faces': (ValueError, lambda: VOL.validate_meshes([cube(faces=[])])),
    'faces of the wrong shape': (ValueError, lambda: VOL.validate_meshes([cube(faces=[[0, 1]])])),
    'a level that is NaN': (ValueError, lambda: VOL.validate_meshes([cube(level=float('nan'))])),
    'a group that is empty': (ValueError, lambda: VOL.validate_meshes([cube(group='')])),
    'more than 500 meshes': (ValueError, lambda: VOL.validate_meshes([cube('m%d' % i) for i in range(501)])),
}
for why, (exc, fn) in CASES.items():
    m = raises(exc, fn)
    ok(m is not None and len(m) > 12, 'validate_meshes REFUSES %s - %s' % (why, (m or 'ACCEPTED')[:80]))

# ---- add_volume -------------------------------------------------------------
tmp = tempfile.mkdtemp()
v = fresh(tmp)
ok(hasattr(v, 'add_volume'), 'view.add_volume exists')
if hasattr(v, 'add_volume'):
    r = v.add_volume([cube('a', group='G'), cube('b', group='G')], style='wire')
    ok(r is v, 'add_volume chains')
    p = v._plugins.get('volume')
    ok(p is not None and p['apiVersion'] == 1 and p['version'] == VOL.VERSION
       and len(p['payloads']) == 1 and [m['id'] for m in p['payloads'][0]['payload']['meshes']] == ['a', 'b']
       and p['options'].get('style') == 'wire',
       'it stores ONE viewer-level payload under "volume" with version, apiVersion and style')
    snap = json.dumps(v._plugins, sort_keys=True)
    for why, call in {
        'a duplicate id against an earlier call': lambda: v.add_volume([cube('a')]),
        'a malformed mesh': lambda: v.add_volume([cube('z', color='nope')]),
        'a name other than volume': lambda: v.add_volume([cube('y')], name='other'),
        'a style that is not wire or solid': lambda: v.add_volume([cube('y')], style='glass'),
        'max_edges_per_mesh < 1': lambda: v.add_volume([cube('y')], max_edges_per_mesh=0),
        'a bound object that is not a name': lambda: v.add_volume([cube('y')], object=3),
    }.items():
        m = raises((ValueError, TypeError), call)
        ok(m is not None and json.dumps(v._plugins, sort_keys=True) == snap,
           'add_volume REFUSES %s and stores nothing - %s' % (why, (m or 'ACCEPTED')[:70]))
    v.add_volume([cube('c')], style='solid', max_edges_per_mesh=2000, legend=False)
    p = v._plugins['volume']
    ok(len(p['payloads']) == 2 and p['options']['style'] == 'solid' and p['options']['maxEdgesPerMesh'] == 2000
       and p['options']['legend'] is False,
       'a second call APPENDS a payload; options are viewer-wide, the last call wins')

    # ---- the page: the plugin's JavaScript, once, only for a viewer that has the payload
    html = v.to_html()
    ok(html.count('<script data-py2dmol-plugin="volume">') == 1,
       'the page carries the volume plugin script exactly once')
    plain = fresh(tmp).to_html()
    ok('data-py2dmol-plugin="volume"' not in plain and "py2dmol_plugins['" not in plain,
       'a viewer WITHOUT a volume payload carries none of it (zero cost when unused)')
    src = V._plugin_source('volume') if hasattr(V, '_plugin_source') else ''
    ok(src and 'py2dmolPlugins' in src and '</script' not in src.lower() and '<!--' not in src,
       'the shipped source registers itself and passes register_plugin\'s refusals (%d bytes)' % len(src))
    try:
        py2Dmol.register_plugin('volume_copy', src)
        ok(True, 'register_plugin accepts the shipped source')
    except Exception as e:
        ok(False, 'register_plugin accepts the shipped source: %s' % e)
    m = re_m = None

    # ---- state round trip
    st = os.path.join(tmp, 's.json')
    old, sys.stdout = sys.stdout, open(os.devnull, 'w')
    try:
        v.save_state(st)
    finally:
        sys.stdout = old
    w = py2Dmol.view(style='cartoon', id='fixedid')
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        old, sys.stdout = sys.stdout, open(os.devnull, 'w')
        try:
            w.load_state(st)
        finally:
            sys.stdout = old
    ok(not any('plugin' in str(c.message) for c in caught),
       'load_state does NOT call volume an unknown plugin (it ships with py2Dmol)')
    ok(json.dumps(w._plugins, sort_keys=True) == json.dumps(v._plugins, sort_keys=True),
       'the payload round-trips save_state -> load_state unchanged')
    ok(w.to_html().count('<script data-py2dmol-plugin="volume">') == 1,
       '...and the loaded viewer\'s page carries the plugin script (no add_volume call in this process)')
    st2 = os.path.join(tmp, 's2.json')
    old, sys.stdout = sys.stdout, open(os.devnull, 'w')
    try:
        w.save_state(st2)
    finally:
        sys.stdout = old
    ok(json.load(open(st))['plugins'] == json.load(open(st2))['plugins'], '...and save_state again writes the same plugins')

# ---- palette ----------------------------------------------------------------
ok(VOL.palette(1) and len(VOL.palette(5)) == 5 and all(len(c) == 7 and c[0] == '#' for c in VOL.palette(5, 'diverging')),
   'palette(n) gives n #rrggbb colours, both kinds')
ok(VOL.palette(3, 'diverging')[1] == '#f7f7f7' and VOL.palette(2)[0] != VOL.palette(2)[1],
   '...the diverging middle is white and a sequential ramp changes')
ok(raises(ValueError, VOL.palette, 3, 'rainbow') is not None and raises(ValueError, VOL.palette, 0) is not None,
   '...and refuses a bad kind or n')

# ---- meshes_from_grid -------------------------------------------------------
try:
    import skimage  # noqa: F401
    HAVE_SK = True
except ImportError:
    HAVE_SK = False
    print('SKIP meshes_from_grid checks need scikit-image (pip install scikit-image)')

S = 0.5
N = 41
CEN = np.array([10.0, 10.0, 10.0])


def well(origin=(0.0, 0.0, 0.0), spacing=S, n=N, centre=CEN, depth=3.0, sigma=3.0):
    """f = -depth * exp(-r^2 / 2 sigma^2): a ΔG-like WELL, minimum at `centre` (Angstrom)."""
    sp = np.broadcast_to(np.asarray(spacing, float), (3,))
    ax = [np.asarray(origin[i]) + np.arange(n) * sp[i] for i in range(3)]
    X, Y, Z = np.meshgrid(*ax, indexing='ij')
    r2 = (X - centre[0]) ** 2 + (Y - centre[1]) ** 2 + (Z - centre[2]) ** 2
    return -depth * np.exp(-r2 / (2 * sigma ** 2))


def r_of(level, depth=3.0, sigma=3.0):
    return math.sqrt(-2 * sigma ** 2 * math.log(-level / depth))


def signed_volume(vv, ff):
    a, b, c = vv[ff[:, 0]], vv[ff[:, 1]], vv[ff[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)


if HAVE_SK:
    f = well()
    ms = VOL.meshes_from_grid(f, (0, 0, 0), S, [-1.0, -2.0], labels=['outer', 'inner'], group='probe')
    ok(len(ms) == 2 and [m['id'] for m in ms] == ['probe:outer', 'probe:inner']
       and all(m['group'] == 'probe' for m in ms), 'one mesh per level, ids "group:label"')
    ok(VOL.validate_meshes(ms), 'the result passes validate_meshes as it is')
    for m, lvl in zip(ms, (-1.0, -2.0)):
        rr = np.linalg.norm(m['vertices'] - CEN, axis=1)
        ok(abs(rr.mean() - r_of(lvl)) < S and rr.std() < 0.1 * S,
           'level %g: radius %.3f recovered to within a voxel of %.3f (spread %.3f)' % (lvl, rr.mean(), r_of(lvl), rr.std()))
    # ---- the sign convention: the surface at a NEGATIVE level encloses the voxels BELOW it
    m = ms[0]
    ix = (CEN / S).astype(int)
    ok(f[tuple(ix)] < -1.0, 'the field is below the level at the centre of the shell (it encloses the well)')
    ok(signed_volume(m['vertices'], m['faces']) > 0,
       'inside="below": the triangles wind OUTWARD (positive signed volume %.1f)' % signed_volume(m['vertices'], m['faces']))
    up = VOL.meshes_from_grid(-f, (0, 0, 0), S, [1.0], inside='above')
    ok(len(up) == 1 and signed_volume(up[0]['vertices'], up[0]['faces']) > 0,
       'inside="above" on the mirrored field winds outward too')
    flipped = VOL.meshes_from_grid(f, (0, 0, 0), S, [-1.0], inside='above')
    ok(signed_volume(flipped[0]['vertices'], flipped[0]['faces']) < 0,
       'the wrong `inside` flips the winding (negative signed volume): the control for the check above')
    # the vertices are ON the level: sample the analytic field
    vv = m['vertices']
    fv = -3.0 * np.exp(-((vv - CEN) ** 2).sum(1) / 18.0)
    ok(np.abs(fv - (-1.0)).max() < 0.05, 'every vertex lies on the isosurface (max |f - level| = %.4f)' % np.abs(fv + 1).max())
    # ---- origin and anisotropic spacing
    org = (-20.0, 5.0, 100.0)
    sp3 = (0.5, 0.4, 0.6)
    g2 = well(origin=org, spacing=sp3, n=45, centre=np.array([-9.0, 12.0, 108.0]))
    m2 = VOL.meshes_from_grid(g2, org, sp3, [-1.0])[0]
    ctr = m2['vertices'].mean(axis=0)
    ok(np.abs(ctr - np.array([-9.0, 12.0, 108.0])).max() < 0.2,
       'origin and per-axis spacing are applied: centre %s' % np.round(ctr, 2))
    ok(abs(np.linalg.norm(m2['vertices'] - np.array([-9.0, 12.0, 108.0]), axis=1).mean() - r_of(-1.0)) < 0.6,
       '...and the radius survives anisotropic voxels')
    # ---- NaN masking
    g = f.copy()
    g[28:, :, :] = np.nan                     # everything with x >= 14 A is missing
    mn = VOL.meshes_from_grid(g, (0, 0, 0), S, [-1.0])[0]
    xs = mn['vertices'][:, 0]
    rr = np.linalg.norm(mn['vertices'] - CEN, axis=1)
    ok(xs.max() <= 13.5 + 1e-6, 'NaN voxels never form surface: no vertex at or beyond the missing data (max x %.2f < 14)' % xs.max())
    ok(np.abs(rr - r_of(-1.0)).max() < S, 'and no WALL is made where the data stops: every vertex is still on the sphere (max |r - r0| %.3f)' % np.abs(rr - r_of(-1.0)).max())
    ok(len(mn['vertices']) < len(ms[0]['vertices']), 'the surface is cut open (%d of %d vertices)' % (len(mn['vertices']), len(ms[0]['vertices'])))
    ok(raises(ValueError, VOL.meshes_from_grid, g, (0, 0, 0), S, [-1.0], mask_nan=False) is not None,
       'mask_nan=False on a grid with NaN raises rather than meshing garbage')
    gi = f.copy(); gi[28:, :, :] = np.inf
    ok(VOL.meshes_from_grid(gi, (0, 0, 0), S, [-1.0])[0]['vertices'][:, 0].max() <= 13.5 + 1e-6, 'infinite voxels are masked like NaN')
    # ---- a level with no surface is skipped with a warning
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        got = VOL.meshes_from_grid(f, (0, 0, 0), S, [-1.0, 5.0, -50.0])
    ok(len(got) == 1 and sum('skipped' in str(c.message) for c in caught) == 2,
       'levels outside the data are SKIPPED with a warning each, never an empty mesh (%d warnings)' % len(caught))
    allnan = np.full((5, 5, 5), np.nan); allnan[0, 0, 0] = 1.0
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        ok(VOL.meshes_from_grid(allnan, (0, 0, 0), 1.0, [0.5]) == [], 'a grid that is all NaN yields no meshes, not an error')
    for why, call in {'a 2-D grid': lambda: VOL.meshes_from_grid(np.zeros((4, 4)), (0, 0, 0), 1, [0.5]),
                      'spacing 0': lambda: VOL.meshes_from_grid(f, (0, 0, 0), 0, [-1]),
                      'NaN levels': lambda: VOL.meshes_from_grid(f, (0, 0, 0), S, [float('nan')]),
                      '3 labels for 2 levels': lambda: VOL.meshes_from_grid(f, (0, 0, 0), S, [-1, -2], labels=['a', 'b', 'c']),
                      'a bad `inside`': lambda: VOL.meshes_from_grid(f, (0, 0, 0), S, [-1], inside='left')}.items():
        ok(raises(ValueError, call) is not None, 'meshes_from_grid REFUSES %s' % why)

# ---- NaN on EVERY side of the data, in every direction (review fix 1) -------
# scikit-image's `mask=` skips a cube by ONE corner only, so NaN on the LOW side of an axis left
# cubes meshed against the fill value: a wall at the data boundary. The test used to mask only
# the high side, which is why it slipped. Here a sphere of R = 3 sits on an anisotropic grid
# with a non-zero origin and NaN is cut in on each side of each axis, a slab through the middle,
# and for both `inside` conventions. Each case asserts, INDEPENDENTLY of the code under test:
#   * no vertex off the true sphere (a wall puts them hundreds of vertices off it);
#   * no surviving face whose cell (floor of its centroid in index space) has a non-finite corner;
#   * the survivors are EXACTLY the faces of the NaN-free mesh that sit in all-finite cells.
if HAVE_SK:
    _N, _SP, _ORG, _C = (30, 40, 50), (0.5, 0.4, 0.3), (10.0, -5.0, 3.0), (17.0, 3.0, 10.0)
    _AX = [_ORG[i] + np.arange(_N[i]) * _SP[i] for i in range(3)]
    _X, _Y, _Z = np.meshgrid(*_AX, indexing='ij')
    _R = np.sqrt((_X - _C[0]) ** 2 + (_Y - _C[1]) ** 2 + (_Z - _C[2]) ** 2)

    def _cells_ok(field, verts, faces):
        """For each face: are all 8 corners of the cell holding its centroid finite?"""
        cen = verts[faces].mean(axis=1)
        idx = (cen - np.array(_ORG)) / np.array(_SP)
        cell = np.clip(np.floor(idx).astype(int), 0, np.array(_N) - 2)
        fin = np.isfinite(field)
        good = np.ones(len(faces), bool)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    good &= fin[cell[:, 0] + dx, cell[:, 1] + dy, cell[:, 2] + dz]
        return good, cen

    def nan_case(label, nan_where, inside='below'):
        f = (_R - 3.0) if inside == 'below' else (3.0 - _R)
        ref = VOL.meshes_from_grid(f, _ORG, _SP, [0.0], inside=inside)[0]
        g = f.copy()
        g[nan_where] = np.nan
        got = VOL.meshes_from_grid(g, _ORG, _SP, [0.0], inside=inside)
        if len(got) != 1:
            ok(False, 'NaN %s: expected one mesh, got %d' % (label, len(got)))
            return
        v, fa = got[0]['vertices'], got[0]['faces']
        off = int((np.abs(np.linalg.norm(v - np.array(_C), axis=1) - 3.0) > 0.1).sum())
        good, _ = _cells_ok(g, v, fa)
        rgood, rcen = _cells_ok(g, ref['vertices'], ref['faces'])
        survivors = np.sort(np.round(v[fa].mean(axis=1), 6), axis=0)
        expected = np.sort(np.round(rcen[rgood], 6), axis=0)
        same = survivors.shape == expected.shape and np.allclose(survivors, expected, atol=1e-6)
        ok(off == 0 and good.all() and same and len(fa) > 100,
           'NaN %-22s %-5s: %d vertices off the sphere, %d faces in non-finite cells, survivors %d = reference faces in finite cells %d'
           % (label, inside, off, int((~good).sum()), len(fa), int(rgood.sum())))

    for ax_i, ax_n in enumerate('xyz'):
        coord = (_X, _Y, _Z)[ax_i]
        for side, sel in (('low', lambda c, a=ax_i: c < _C[a]), ('high', lambda c, a=ax_i: c > _C[a])):
            nan_case('%s on the %s side' % (ax_n, side), sel(coord))
    nan_case('slab through the middle', (_X > 16.1) & (_X < 16.6))
    nan_case('x low side', _X < _C[0], inside='above')
    nan_case('z low side', _Z < _C[2], inside='above')
    nan_case('y high side', _Y > _C[1], inside='above')
    # a level that lies ENTIRELY in the missing data is skipped, not meshed against the fill
    _g = _R.copy()
    _g[_R > 3.5] = np.nan
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        got = VOL.meshes_from_grid(_g, _ORG, _SP, [4.0, 3.0])
    ok(len(got) == 1 and got[0]['level'] == 3.0 and sum('skipped' in str(c.message) for c in caught) == 1,
       'a level entirely inside the NaN region (4.0, NaN beyond r = 3.5) is skipped with a warning (%d mesh, %d warnings)'
       % (len(got), len(caught)))

# ---- review fix 4: an all-NaN grid, colliding level labels, the option-key length limit ----------
if HAVE_SK:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            got = VOL.meshes_from_grid(np.full((4, 4, 4), np.nan), (0, 0, 0), 1.0, [0.5])
            err = None
        except Exception as e:
            got, err = None, '%s: %s' % (type(e).__name__, e)
    ok(got == [] and err is None and any('skipped' in str(c.message) or 'no finite' in str(c.message) for c in caught),
       'a grid that is ALL NaN returns [] with a warning (not a numpy crash)%s' % (' - ' + err if err else ''))
    _w = well()
    two = VOL.meshes_from_grid(_w, (0, 0, 0), S, [-1.0, -1.0000001])
    ids = [m['id'] for m in two]
    ok(len(two) == 2 and len(set(ids)) == 2 and VOL.validate_meshes(two),
       'levels [-1, -1.0000001] get DISTINCT ids and pass validate_meshes (%s)' % ids)
    m = raises(ValueError, VOL.meshes_from_grid, _w, (0, 0, 0), S, [-1.0, -1.0])
    ok(m is not None and '-1' in m, 'identical levels are refused with a message naming them: %s' % (m or 'ACCEPTED')[:90])
    # (an explicit duplicate label is the caller's: refused the same way)
    m = raises(ValueError, VOL.meshes_from_grid, _w, (0, 0, 0), S, [-1.0, -2.0], labels=['a', 'a'])
    ok(m is not None, 'duplicate explicit labels are refused (%s)' % (m or 'ACCEPTED')[:70])

# the option key is "visible.group.<group>" / "visible.mesh.<id>" and must fit the plugin's 300-character limit
ok(VOL.validate_meshes([cube('i' * 287, group='g' * 286)]), 'an id of 287 and a group of 286 characters fit (keys of exactly 300)')
for why, kw in (('an id of 288', dict(mid='i' * 288)), ('a group of 287', dict(group='g' * 287))):
    mid = kw.pop('mid', 'c')
    m = raises(ValueError, lambda: VOL.validate_meshes([cube(mid, **kw)]))
    ok(m is not None and 'visibility' in m, 'validate_meshes REFUSES %s (its visibility option key would pass 300): %s' % (why, (m or 'ACCEPTED')[:80]))

# THE LIMITS ARE IN UTF-16 CODE UNITS, as JavaScript's .length counts them (round 2, C). An emoji is ONE Python
# character and TWO units, so a Python count would pass an id the browser refuses. tests/volume_plugin.js runs
# the SAME table through the plugin, so the two sides are held to one answer.
E = '\U0001F600'                       # one code point, two UTF-16 units
LIMIT_TABLE = [                        # (field, string, fits?)
    ('id', 'a' * 287, True), ('id', 'a' * 288, False),
    ('id', E * 143, True), ('id', E * 143 + 'a', True), ('id', E * 144, False),
    ('group', 'g' * 286, True), ('group', 'g' * 287, False),
    ('group', E * 143, True), ('group', E * 143 + 'a', False), ('group', E * 144, False),
]
for field, text, fits in LIMIT_TABLE:
    kw = {'id': dict(mid=text), 'group': dict(group=text)}[field]
    mid = kw.pop('mid', 'c')
    m = raises(ValueError, lambda: VOL.validate_meshes([cube(mid, **kw)]))
    ok((m is None) == fits, 'Python: a %s of %d UTF-16 units (%d characters) %s%s'
       % (field, len(text.encode('utf-16-le')) // 2, len(text), 'fits' if fits else 'is REFUSED',
          '' if (m is None) == fits else ' - WRONG: ' + str(m)[:60]))
if HAVE_SK:
    _w2 = well()
    for why, kw, named in (('a group of 286 whose "group:label" id is 288', dict(group='g' * 286, labels=['x', 'y']), 'id'),
                           ('a group of 287', dict(group='g' * 287), 'group'),
                           ('a label of 301', dict(labels=['x' * 301, 'y']), 'label'),
                           ('an emoji group of 143 + a label (id of 289 units)', dict(group=E * 143, labels=['x', 'y']), 'id')):
        m = raises(ValueError, VOL.meshes_from_grid, _w2, (0, 0, 0), S, [-1.0, -2.0], **kw)
        ok(m is not None and named in m, 'meshes_from_grid REFUSES %s up front, naming the %s: %s' % (why, named, (m or 'ACCEPTED')[:90]))
    ok(len(VOL.meshes_from_grid(_w2, (0, 0, 0), S, [-1.0], group='g' * 284, labels=['x'])) == 1,
       'meshes_from_grid: a group of 284 + ":x" (an id of exactly 287) is accepted')

# ---- scikit-image is imported only when the function is CALLED --------------
out = subprocess.run([sys.executable, '-c',
                      'import sys; sys.path.insert(0, %r); import py2Dmol, py2Dmol.volume; print("skimage" in sys.modules)' % ROOT],
                     capture_output=True, text=True)
ok(out.stdout.strip().endswith('False'), 'importing py2Dmol and py2Dmol.volume does NOT import scikit-image (lazy)')
saved = {k: sys.modules.get(k) for k in ('skimage', 'skimage.measure')}
sys.modules['skimage'] = None
sys.modules['skimage.measure'] = None
try:
    msg = raises(ImportError, VOL.meshes_from_grid, np.zeros((3, 3, 3)), (0, 0, 0), 1, [0.5])
finally:
    for k, val in saved.items():
        if val is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = val
ok(msg is not None and 'pip install scikit-image' in msg and 'scikit-image' in msg,
   'without scikit-image the error NAMES the package and the command: "%s"' % (msg or '')[:80])

# ---- a mesh with NO faces is never returned, even from a marching cubes that hands one back
# (scikit-image raises for "no surface", which the earlier check covers; this is the other way a
# surface can come back empty, so the guard is exercised with a stand-in that returns it)
_fm = types.ModuleType('skimage.measure')
_fm.marching_cubes = lambda *a, **k: (np.zeros((0, 3)), np.zeros((0, 3), dtype=int), None, None)
_fs = types.ModuleType('skimage')
_fs.measure = _fm
_saved = {k: sys.modules.get(k) for k in ('skimage', 'skimage.measure')}
sys.modules['skimage'], sys.modules['skimage.measure'] = _fs, _fm
try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        got = VOL.meshes_from_grid(np.zeros((3, 3, 3)), (0, 0, 0), 1, [0.5, 0.7])
finally:
    for k, val in _saved.items():
        if val is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = val
ok(got == [] and sum('no faces' in str(c.message) for c in caught) == 2,
   'a surface that comes back with ZERO faces is skipped with a warning, never returned as an empty mesh (%d warnings)' % len(caught))

print('volume state:', 'FAILED %d' % bad if bad else 'ok')
sys.exit(1 if bad else 0)
