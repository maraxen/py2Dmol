# Plugins: a supported way to draw things that are not residues

**Status: proposal, 2026-09-30. Nothing here is implemented.** Written from a
host library's need (below) and from reading and running the current code;
every claim about today's behaviour carries a file:line or a measurement, and
everything that has NOT been measured is listed in "Spikes before code" rather
than assumed.

## 1. Why

A host library (first one: naurmalade, drawing cosolvent free-energy densities
around a protein) needs geometry that is not a residue: an isosurface shell per
probe, labelled site markers, contacts from a marker to a residue. py2Dmol has
no supported way to add it. What a host can do today, measured (1CRN,
`preset="richardson"`, `sidechains=True`, real Chromium via WebGL2):

| route | result |
|---|---|
| markers as `position_types='L'` atoms in the protein's object | draws, coloured per position, focus and side chains coexist, marker-to-residue lines via `add_contacts` |
| marker size | **fixed by element**: a lone atom's radius is its full vdW radius (`src/cartoon/geom.js:534` `loneAtomRadiusA`, table at `:480`); smallest is H at 1.2 A. There is no per-marker radius argument |
| points closer than ~2 A | grow sticks: bonds are derived by distance |
| `set_opacity` on markers | a 4x4 ordered **dither**, not alpha (`src/cartoon/paintgl.js:695`); at 0.35 it reads as a grey moire hatch, and a nearer sphere still hides a farther one |
| density as a point cloud | credible only at ~60-100 solid, sparse points; ~200 already occludes the protein, 1000 buries it |
| extra per-object payload through `save_state` | **dropped**: `save_state` is a whitelist (`py2Dmol/viewer.py:4935-4939`, `:4960-5000`); an unknown key is gone after `load_state`. Side finding: `sidechain_atoms` is not in the saved JSON either |

So a density view needs the renderer's help. This document proposes the
smallest supported surface that gives it, and that is not specific to density.

## 2. What exists, and the seams

- **Parts** (`window.py2dmolMolParts`, `src/core/mol.js:1287` `installMolParts`)
  copy methods onto the renderer prototype. Nothing calls them from `render()`,
  so a part can add a method but cannot draw. And the registry is **sealed by
  the first viewer**: `parts.push` then throws (`mol.js:1305-1310`), and the
  notebook prepends scripts, so load order there is reversed.
- **The primitive list** is built inside `render()` (`src/cartoon/geom.js:5077`;
  `const prims = []` at `:6524`) from these kinds: `rib`, `line`, `tube`,
  `stickFace`, `ribStroke`, `joint`, `dot`. Both painters draw that one list
  (`paint2d.js` to a canvas, `paintgl.js` to WebGL2), z-sorted. There is **no
  triangle primitive** and no alpha blending.
- **Registration and inlining**: `MODULES` in `tools/bundle.py:73` is the
  manifest; `viewer.py` inlines the built bundle into the HTML.
- **Capture** (`src/parts/capture.js`, `src/core/svg.js`) draws from the same
  prim list, so anything in it is captured for free.

The nearest thing to a hook is monkeypatching `window.py2dmolCartoon`, which is
unsupported.

## 3. Requirements

R1. A plugin can contribute drawn geometry that both painters draw, depth-sorted
   with the cartoon, and that appears in PNG/SVG/GIF capture.
R2. Registration works at any time. Late registration must not throw the way
   `parts.push` does; it applies to viewers created afterwards and to existing
   ones on attach.
R3. Data comes from Python (`view.add_plugin(...)`), is JSON-serializable, is
   carried in the generated HTML, and **survives `save_state`/`load_state`
   including plugins the loader does not know** (kept verbatim, warned about).
R4. Zero cost and zero change when no plugin is used: same bundle behaviour,
   same `paint_trace` digest.
R5. A plugin may add rows to the Style panel and legend entries, and touches no
   DOM outside the viewer.
R6. A plugin declares an `apiVersion`; the core refuses a mismatch with a
   message, not a silent no-op.
R7. Geometry is budgeted: the host is told the cap (`maxPrims`) and the core
   refuses to exceed it loudly.

## 4. Proposed API

### Python

```python
v = py2Dmol.view(...)
v.add_plugin("volume", payload, object=None, frame=None, options=None)
v.set_plugin_option("volume", "level:-1.0:visible", False)
py2Dmol.register_plugin(name, js_source, version)   # external plugin, optional (D1)
```

`payload` is plain JSON; the plugin defines its schema. `object`/`frame` bind it
like `add_contacts` does (`viewer.py:4389`).

### JavaScript

```js
window.py2dmolPlugins.register({
  name: "volume", version: "0.1", apiVersion: 1,
  init(host)      { /* per viewer -> instance */ },
  setPayload(object, frame, payload) {},
  prims(ctx)      { /* return prim[]; called inside render(), before the z-sort */ },
  rows()          { /* Style-panel rows */ },
  legend()        { /* legend entries */ },
  serialize()     { /* -> JSON for save_state */ },
  restore(state)  {},
  dispose()       {},
});
```

`ctx` gives the model-to-view transform, the visible objects, the frame, the
options, and `maxPrims`. The registry is a plain list read at viewer creation
AND on demand; it is not sealed (R2).

### Primitives a plugin may return

`line` and `dot` exist. Two decisions are open (section 6): a **sphere with a
caller-set radius** (today's atom radius is element-fixed) and a **flat-shaded
triangle** (`tri`: three points, one colour, optional cover 0-1 through the
existing dither). Each new kind must be implemented in BOTH painters, and in the
SVG context or declared `svg: false` by the plugin.

### State

`save_state` gains `plugins: {name: {version, apiVersion, objects: {...}}}`;
unknown names are preserved on a round trip.

## 5. The first plugin: `volume` (naurmalade's consumer)

Specified here so the API is judged against a real user, implemented after the
API lands.

- **Payload is a mesh, not a grid.** The host extracts isosurfaces (marching
  cubes, in Python, at the requested levels) and sends vertices, faces and a
  colour per level. JS stays a thin renderer; no marching cubes or DX parsing
  in the browser.
- Per level: one shell. Default rendering is **wireframe** (`line` prims from
  the mesh edges) because it needs no blending and does not hide the protein;
  optional solid `tri` at a set cover for a hard-edged look.
- Style rows: per probe/level visibility, wire vs solid, cover; legend entries
  with the probe colour and the level in kcal/mol.
- Budget: the host decimates to `maxPrims`; the plugin reports how many prims it
  emitted.

## 6. Decisions to settle (before code)

D1. **External JS registration in v1, or in-tree plugins only?** Cost of
    including it is small (same registry); the price is a trust statement: a
    plugin is inline script in an HTML the reader opens, exactly like the core.
    Leaning: include, and say so in the docs.
D2. **`tri` primitive vs wireframe only.** Wireframe-only is a `line` change
    of zero painter work; `tri` is real work in two painters plus the SVG
    context. Leaning: ship wireframe first, add `tri` only if a spike shows
    it costs little.
D3. **Sphere with a caller radius**: needed for small site markers (element
    vdW is >= 1.2 A). Could be a `dot` option instead of a new kind.
D4. **Translucency**: dither only (measured ugly at 0.35), or a real blend
    pass in `paintgl.js`. Leaning: out of scope for v1; wireframe covers the
    density use case.

## 7. Spikes before code

| id | question | how |
|---|---|---|
| P1 | Can a `line`/`dot` prim injected from a monkeypatch of `py2dmolCartoon` reach both painters and capture unchanged? (cheap proof the prim list is the right seam) | 20-line patch in a scratch page, compare `paint_trace` and a capture |
| P2 | Cost of 20k-50k `line` prims on the GPU path and the 2D fallback (frame time, memory) | measure on a real browser, not software GL alone |
| P3 | What a `tri` needs in `paint2d.js`, `paintgl.js` and `core/svg.js` (read the `line` path end to end first) | code reading, then a throwaway branch |
| P4 | `save_state` extension: can unknown plugin payload round-trip without touching the frame whitelist? | prototype against `viewer.py:4909-5039` |

## 8. Tests

- `tests/paint_trace.js` digest for a fixed synthetic mesh, both painters.
- No-plugin regression: existing digests unchanged (R4).
- Round trip: `save_state` -> `load_state` with a known and an unknown plugin.
- Late registration: register after the first viewer exists; no throw.
- Budget: a payload over `maxPrims` fails with the documented message.

## 9. Not proposed

Picking/selection of plugin geometry, live-updating payloads, a plugin
marketplace, alpha blending, and any change to how residues are drawn.
