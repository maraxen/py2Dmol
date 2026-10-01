# Plugins: a supported way to draw things that are not residues

A plugin is a named piece of JavaScript that returns lines, balls and triangles, plus a JSON payload
Python hands it. The renderer draws them with the cartoon, depth-sorted with it, in both painters, in
PNG and SVG exports, and through `save_state` / `load_state`. This document is the contract and the
evidence for it: what exists, what it promises, what it costs, and what was not checked.

The core is the registry, the seam in `cartoon/geom.js`, both painters' support, the Python API, the
state round trip, the per-painter primitive budget and the fit-to-view floor. On top of it a plugin
can add rows to the Style panel and a legend to the viewer and to exported figures (section 14). One
plugin ships with py2Dmol, `volume`, which draws isosurface shells: `docs/PLUGIN_VOLUME.md`. Section 12
lists what is not built.

## 1. Why

A host library that draws free-energy isosurfaces around a protein needs geometry that is not a
residue: a shell per level, labelled site markers, contacts from a marker to a residue. py2Dmol had no
supported way to add it. What a host could do before, measured before this change (1CRN,
`preset="richardson"`, `sidechains=True`, real Chromium via WebGL2):

| route | result |
|---|---|
| markers as `position_types='L'` atoms in the protein's object | draws, coloured per position, focus and side chains coexist, marker-to-residue lines via `add_contacts` |
| marker size | **fixed by element**: a lone atom's radius is its full vdW radius (`src/cartoon/geom.js` `loneAtomRadiusA`); smallest is H at 1.2 A. There is no per-marker radius argument |
| points closer than ~2 A | grow sticks: bonds are derived by distance |
| `set_opacity` on markers | a 4x4 ordered **dither**, not alpha; at 0.35 it reads as a grey moire hatch, and a nearer sphere still hides a farther one |
| density as a point cloud | credible only at ~60-100 solid, sparse points; ~200 already occludes the protein, 1000 buries it |
| extra per-object payload through `save_state` | **dropped**: `save_state` is a whitelist for objects; an unknown key is gone after `load_state` |

So a density view needs the renderer's help. This is the smallest supported surface that gives it,
and it is not specific to density.

## 2. What exists, and the seam

- **`window.py2dmolPlugins`** (`src/parts/plugins.js`) is the registry. It is **not** a viewer-mol
  part. Those (`window.py2dmolMolParts`, `installMolParts` in `src/core/mol.js`) copy methods onto the
  renderer prototype, nothing calls them from `render()`, and the queue is **sealed by the first
  viewer** (`parts.push` throws afterwards) while the notebook prepends scripts, so load order there is
  reversed. A plugin has to be able to register at any time, so the registry is a plain object created
  if absent on both sides.
- **The primitive list** is built inside `render()` (`src/cartoon/geom.js`, `const prims = []`) from
  `rib`, `line`, `tube`, `stickFace`, `ribStroke`, `joint`, `dot`. Both painters draw that one list
  (`paint2d.js` to a canvas, `paintgl.js` to WebGL2), z-sorted. There is **no triangle primitive** and
  no alpha blending. The GPU painter reaches the list through `_probeOnly`: it sets it, `render()`
  returns at the sort, and `facesOf` turns the prims into a mesh that is drawn from a camera uniform
  until the signature changes.
- **The seam** is one call in `geom.js`'s `render()`, after the depth range and before the
  backbone-hide and clip-slab filters, the sort and the `_primProbe` export. It appends the plugins'
  prims to the list, so the z-order is shared, the clip slab culls them like everything else, and the
  GPU path sees them. With no plugin it is one property read.
- **Capture** (`src/parts/capture.js`, `src/core/svg.js`) draws from the same list, so a plugin's
  geometry is in PNG and SVG exports without further work.
- **Registration and inlining**: `MODULES` in `tools/bundle.py` is the manifest (the registry is in
  every bundle); `viewer.py` inlines the built bundle into the page, and a registered plugin's source
  beside it.

## 3. Requirements, and where each is met

| | requirement | as built |
|---|---|---|
| R1 | a plugin contributes geometry both painters draw, depth-sorted with the cartoon, and captured | `collect()` at the seam in `geom.js`; `tests/plugin_seam.js` (2D, depth sort) and `tests/plugin_browser.py` (both painters, PNG and SVG capture) |
| R2 | registration at any time; late registration must not throw | the registry is created if absent on both sides; a definition parked before the bundle is adopted by it; `register()` after a viewer is up binds and redraws it |
| R3 | data from Python, in the page, through `save_state` / `load_state`; unknown plugins kept verbatim with a warning | viewer-level `state["plugins"]`; one warning per load naming every unknown name; `tests/plugin_state.py` |
| R4 | zero change with no plugin | no-plugin `to_html()` and `save_state()` are byte-identical to before; the paint trace is unchanged (section 4) |
| R5 | Style-panel rows and a legend, with no DOM outside the viewer | `rows(ctx)` and `legend(ctx)` in the definition, validated by the registry, mounted by `parts/panel.js` and `parts/ui.js`, drawn into PNG and SVG exports by `parts/capture.js` (section 14); `tests/plugin_rows.js`, `tests/plugin_rows_browser.py` |
| R6 | `apiVersion` checked, with a message | `register()` compares with `PLUGIN_API_VERSION` (1) and refuses by name, with both versions and what to do; a missing `apiVersion` is refused too. **A refusal never throws**, wherever it happens (a direct call, or a definition parked before the bundle, where a throw would kill the whole bundle): it is recorded in `py2dmolPlugins.rejected`, said once on the console, and `register()` returns `null` |
| R7 | geometry budgeted, refused loudly | `ctx.maxPrims` per painter; overrunning **throws** (section 7) |

## 4. The guarantee: nothing changes without a plugin

- A viewer with no plugin writes the **same bytes** as before: `to_html()` and `save_state()` are
  identical to what they were before this change, and nothing about plugins appears in either. `tests/plugin_state.py
  --golden DIR` compares them with a golden recorded from a tree that has no plugin work
  (`--write-golden`, see `tests/README.md`); bare, it prints SKIP for that comparison.
- The drawing is unchanged: `node tests/paint_trace.js` reports the same digest as before this change, 11
  fixtures and 26,703 ops, checked against a baseline recorded with `--save` from the tree without it. An empty
  registry, a registry whose plugin the viewer has no payload for, and a plugin that emits nothing all
  draw byte-identically to no registry (`tests/plugin_seam.js`).
- The Style panel of a viewer with no plugin rows is the panel `buildStylePanel` always built, byte for
  byte, and no legend element exists (section 14; `tests/plugin_rows.js`).
- The GPU signature gains one term, `window.py2dmolPlugins.key(r)`, which is `''` for a viewer with
  no plugin, so it is the signature it was.
- What it does cost is bundle size: section 10.

## 5. The API as built

### Python

```python
py2Dmol.register_plugin(name, js_source, version=None)   # external JS, inlined per page
v = py2Dmol.view(...)
v.add_plugin(name, payload, object=None, frame=None, options=None,
             version=None, api_version=None)              # chainable
v.set_plugin_option(name, key, value)
```

- `payload` is anything `json.dumps` takes. **NaN and sets are refused at the call**, not in the page,
  and the payload is **copied** at add time. Every argument is checked before anything is stored, so a
  refusal leaves no half-made entry.
- The payload lives on the **viewer** (`view._plugins`, `state["plugins"]`), never on an object: the
  object whitelist in `save_state` drops an unknown per-object key (`tests/plugin_state.py` keeps that
  as a control).
- `object` binds it to an object by name (as `add_contacts` does); `frame` to a frame; `None` means
  "whatever is drawn". `options` merge over earlier ones.
- It is sent with `show()`. **A viewer already on the page does not see a later `add_plugin`**: it
  warns, and the payload appears when the viewer is shown again (section 12, the live channel).
- Names match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}` (they become an HTML attribute and a state-file key).

### Trust model

A plugin's JavaScript is **inline script in the HTML page the reader opens**, exactly like the core.
There is no sandbox and none is promised: open a page with a plugin only as you would open one with
any other script. It is inlined once per page, for every viewer that carries a payload for that name,
in every bundle mode (inline, external, shared library).

A source containing `</script` (any case) or `<!--` is **refused with `ValueError`**, not escaped:
escaping is only safe inside a string and `register_plugin` cannot know where in the code it is. Write
`"<\/script>"` or `"<" + "!--"`. The *payload* needs no such care: every `<` in it is written as the
six-character escape `<`, which JSON and JavaScript both read back as `<`.

### JavaScript

```js
(function () {
  // works whether it runs before or after the viewer library
  var P = window.py2dmolPlugins = window.py2dmolPlugins || {list: [], pending: []};
  var def = {
    name: "mine", version: "1", apiVersion: 1,
    options: {shown: true},                 // defaults; the viewer's options go over them
    init(host)      { /* once per viewer; host = {renderer, viewerId, requestRender()} */ },
    setPayload(ctx) { /* the viewer's payloads arrived, or changed */ },
    key(ctx)        { return "..." },       // anything that would change what prims() emits
    bounds(ctx)     { return {min: [x,y,z], max: [x,y,z]} },   // MODEL space, or null
    prims(ctx)      { /* draw with ctx.line / ctx.dot / ctx.tri */ },
    dispose(ctx)    {},
  };
  if (P.register) P.register(def); else P.pending.push(def);
})();
```

`prims(ctx)` is called inside `render()`, after the depth range and before the filters and the sort.
**A plugin draws in a viewer only where that viewer has a payload for it** (or JavaScript called
`P.setPayload(renderer, name, data)`); a plugin registered on a page with three viewers costs the
other two nothing.

`ctx` holds `renderer`, `host`, `instance` (what `init` returned), `name`, `version`, `apiVersion`,
`options`, `payloads` (`[{object, frame, payload, index}]`, only those that apply to what is drawn
now), `frame`, `maxPrims`, `painter` (`'2d'`, `'gpu'` or `'svg'`), `scale`, `toView(p, objectName?)`,
`project(x,y,z)`, and three helpers, so a plugin never hand-builds a prim:

| helper | emits | notes |
|---|---|---|
| `ctx.line(a, b, {color, width, ink})` | `kind:'line'` with `pts`, `z`, `w`, `wA`, `c`, `flat:true`, `joints`, `noInk` | `width` in Angstrom, default 0.35. `joints` is required: a line without it throws in `paint2d` at ink time (`tests/plugin_seam.js` keeps that as a control) |
| `ctx.dot(p, {color, radius, ink})` | `kind:'dot'` with `x1,y1,z`, `r`, `rA`, `c`, `noInk` | `radius` in Angstrom, default 0.5. On the GPU a plugin dot has **no palette slot and needs none**: its colour is baked (`pal: -1`), so recolouring the structure leaves it alone and does not flip `__gpuPaletteComplete` (which would turn every recolour of the structure into a rebuild) |
| `ctx.tri(a, b, c, {color})` | the existing `joint` prim with `q:[A,B,C]`, `nl`, `two:true` | opaque, flat-shaded, double-sided, lit by its own normal (`nl`; the GPU drops `unlit`) |

Points are **model space** (the coordinates of the file). `toView` maps them through the object's
`alignTransform`, its own rotation and the viewer's, the same arithmetic `_rotateAt` does for a
position (`core/mol.js` `_viewInto`, one copy; `_modelToView` is its door). Colour is `[r,g,b]`,
`{r,g,b}` or `'#rrggbb'`. Plugin prims are **`noInk` by default** (no dark rim; `ink: true` brings
one): on the GPU the border instance is skipped, and in `paint2d` the ink stroke is skipped and the
occluder grids use the extent actually painted.

**Near plane.** Under perspective, a point behind the camera or within 0.1 A of it makes its
primitive return `false` and be dropped whole. Near-plane clipping is not done.

**Non-finite and absurd coordinates.** `ctx.line/dot/tri` return `false` and drop the primitive when
a coordinate is NaN or infinite, or lies more than **50x the structure's extent (never less than 500
A)** from the view centre. A finite `1e30` is as bad for the GPU depth range as `Infinity`: it would
stretch the range until the cartoon collapsed into one depth step. Nothing non-finite reaches a
painter. The plugin still draws the rest of the frame and is put in an error state that counts what it
dropped ("5 primitives dropped: a coordinate was not finite, or lay more than 1500 A from the view
centre"). `bounds()` is held to the same rule: a box with such a corner is ignored, and is an error.
The reach limit is not configurable, since a setting that could raise it would hand the hazard back.

**Depth.** A plugin's triangle or ball can lie outside the structure's depth span, which is what the
2D painter normalises `near` over. `near` is **clamped to 0..1 for plugin prims** (as the GPU clamps
`near01`), so with depth fade they stay inside their colour ramp instead of extrapolating past it.

**`register()`** returns the registered definition, the existing one (same name and version,
idempotent), or `null` for a refusal; it does not throw. A different version under the same name
replaces the old one, with a console warning.

**The registry is idempotent to a second evaluation.** `py2dmolPlugins.__impl` marks the real
implementation and the state (`__core`: which viewers exist, what they hold) lives on the registry
object, so a second notebook cell that carries its own copy of the library changes nothing and runs
`init` once per viewer. The guard is `__impl >= IMPL`: a page can carry bundles of different ages, the
same or a newer registry wins, and an older bundle loaded afterwards cannot downgrade it. An older (or
no) registry is taken over: its registered plugins are kept, its per-viewer state is started afresh,
and a viewer re-attaches on its next question.

**`dispose`** is called on a plugin being **replaced** (same name, new version). A viewer has no
teardown hook to call it from, so a plugin must not rely on `dispose` for cleanup when a viewer goes
away.

**`key()`** is how the GPU finds out a plugin moved. The registry's combined key folds, per plugin:
its name and version, a revision counter, the viewer's options, which payloads apply to this frame,
and the plugin's own `key(ctx)`; and the GPU primitive cap. It goes into `sharedGeometryKey` in
`paintgl.js`, so into both the full and the topological signature. It does **not** contain error
states: those are a fact about one painter, and an SVG export that overran must not make the next GPU
frame look like a different mesh.

## 6. Framing: `bounds()`, and a floor under the fitted span

`bounds(ctx)` joins the fit-to-view. The registry turns the box into a radius about the view centre
(the same at every rotation, or the picture would zoom as it turned), and `_viewHalfSpan` never lets
the **fitted** span be smaller than it. It only grows the span, and the reader's zoom still divides
it.

**The floor applies to the fit, not to a span somebody set.** Orient, focus and the app write a tight
target through `setViewSpan` (`viewerState.extent`). Flooring that at the plugin's radius would stop a
focus on one residue from zooming closer than a shell drawn around it. So `_viewHalfSpan` applies the
floor only while `viewerState.extent` is unset, and the span an **orient to everything** writes
(`parts/orient.js`; the opening orient of every viewer is one) carries the floor itself, widened by how
far the centre moves. A selection is not everything and gets the tight span it asked for; "orient to
all" frames the plugin again.

**The floor is per axis** (`floorViewSpan` in `orient.js`). A span is stored as `(extent, aspect)`:
`extent * aspect.x` and `extent * aspect.y` are the two half-spans, the stored aspect normalised so its
larger part is 1. Raising the extent alone raises the long axis by the same factor as the short one:
for an elongated structure (aspect 0.053 : 1) a 45 A floor on the short axis would push the long one
to 852 A, 19x what is needed. So each half-span is raised to the floor and written back as (larger,
ratio); the representation is unchanged, and a span that already holds the floor is returned as it was.

Consequences. A plugin that arrives after the opening orient is framed at the next orient to
everything, not at once. `parts/multi.js` reframes without the floor (`setViewSpan(..., maxExtent)` on
an object switch, on leaving multi and on a merge), which drops the plugin floor until the next orient
to everything.

## 7. The budget: THROW, not truncate

Defaults: **2D 8,000 and GPU 60,000** primitives per plugin per frame. `window.py2dmolPlugins.caps`
can be changed by the host before a viewer renders, and the GPU cap is part of the key (a changed cap
is a different mesh). A plugin that emits one more throws `PluginBudgetError` from the helper;
`collect()` catches it and **drops that plugin for the frame, nothing of it, not a truncated 8,000**,
then says so: on the console (once per viewer), in a one-line badge inside the viewer's own box, and in
`py2dmolPlugins.errors(renderer)`. The state clears on the next frame that fits, and other plugins are
unaffected. A plugin that throws for any other reason gets the same treatment and adds nothing: its
earlier prims in that frame are rolled back. A truncated wireframe is a picture that is wrong and looks
right; that is why it throws. The message names the plugin, the cap, both painters' caps and what to
do.

**One cap and one error state per painter.** `errors()` entries carry `painter`: `'2d'`, `'gpu'`,
`'svg'`, `'load'` for `init` / `setPayload` / `key` / `bounds`, or `'ui'` for `rows()` / `legend()`. The GPU harvests geometry under
`_probeOnly`. An **SVG export is always the 2D painter** whatever painter the viewer has, so it is held
to the **2D cap**: a 10,008-line shell the GPU draws is over it. An export cannot show a badge, so it
says so **in the file**, as an XML comment `<!-- py2dmol plugin <name> not drawn: <message> -->`
(`C2S.comment`; `--`, `<`, `>` and the characters XML 1.0 forbids are removed from the message so the
file stays valid), and once on the console. A raster export through the 2D painter (PNG on a 2D viewer)
has no annotation layer and uses the same cap as the screen, where the badge shows it.

**The tube style draws no plugin**: it never reaches `geom.js`'s `render()`. It says so once per
viewer on the console, naming the plugin.

The caps are a decision, not a limit found by measurement. Measured while choosing them (not in the
suite): the 2D painter was still interactive at about 7,700 lines (43 ms median JavaScript per
frame), and the GPU mesh took 46,000 lines through one build. Neither was measured on a real GPU.

## 8. The GPU depth range, and what folding a plugin into it costs the cartoon

`resident.zMin/zMax` is `+-rad`, sized from the faces' corners. A line reaching past it is clipped in
NDC depth, so a shell larger than the structure loses its near and far sides. `buildMeshPart` therefore
folds a **plugin** stroke's model-space extent into `rad` (`lineRad2`, gated on `ln.plugin`: a contact
joins two residues and lies inside, and must not start to matter); it reaches `tailRad` through
`part.rad`. `tests/plugin_browser.py` checks it against the 2D painter, which has no depth range: a
cube larger than the structure covers the same pixels on both (1CRN: GPU 6,442 px, 2D 6,304 px), and
with the fold removed the GPU draws 3,055 against the 2D painter's 6,308.

The fold has a price on the cartoon. Measured once (1CRN, Richardson, GPU, one 0.4 A stroke, no
`bounds` so the fit is unchanged, fold on versus off in the same page; off twice differs by 0 px;
pixels within 4 px of the stroke excluded; about 50,800 ink px):

| stroke at | cartoon px changed | max channel delta |
|---|---|---|
| R = 3 A (inside the structure) | 6 | 91 |
| R = 14 A (at the structure's radius) | 0 | 0 |
| R = 40 A (2.9x the radius) | 610 (1.2% of ink px) | 127 |

On the 2D painter the same three radii change 20, 0 and 0. The 610 are scattered single pixels along
ribbon edges and a patch where two coincident surfaces overlap: a 2.9x wider depth range changes
tie-breaks. The range only grows when a plugin stroke actually reaches past the structure, only on the
GPU, and only in viewers that have a plugin. A separate depth range for plugin geometry would cost a
second pass for something that is speckle at ties.

Two further per-stroke facts live in the same place. `noInk` is part of what a GPU line is: the
group-1 mesh part is cached under `ribbonHashOf(face) ^ linesKeyOf(lines)`, and `linesKeyOf` mixes
`noInk` and `plugin` (only when set, so a contact's hash is what it was); without them, flipping `ink`
with unchanged geometry hands back the cached part with the old rim in it. And a plugin's triangles
and balls are not in the visibility texture's coverage: a GPU face carries a residue id that the fill
shader clamps, so they take the coverage of residue 0 (read in the shader, not measured), while plugin
lines are edge instances with residue -1 and are immune.

## 9. State

`save_state` gains a top-level `plugins` only when there is something:

```json
"plugins": {"mine": {"version": "1", "apiVersion": 1,
  "options": {"shown": true},
  "payloads": [{"object": "crn", "frame": 0, "payload": {}}]}}
```

It round-trips through `load_state` then `save_state`. A name the loading process has not registered
is kept **verbatim** and warned about once (one warning naming every unknown name), because a state
file is a document and loading it in a session that lacks a plugin must not destroy that plugin's
data. In the page the payloads are `window.py2dmol_plugins['<id>']`, a sibling of `py2dmol_configs`,
written only when the viewer has any.

## 10. Costs

Bundle sizes, built with `python3 tools/bundle.py build` (terser 5.51.2). The same toolchain rebuilds
the tree before the plugin work byte-identical to its committed bundles, so these deltas are the plugin
work only. Raw bytes, and `gzip -9 -n`.

Rows and legend, on top of the core:

| bundle | raw bytes | delta | gzip -9 bytes | delta |
|---|---|---|---|---|
| notebook | 667,819 -> 677,128 | +9,309 (+1.39%) | 213,823 -> 216,700 | +2,877 (+1.35%) |
| web | 903,236 -> 912,545 | +9,309 (+1.03%) | 282,486 -> 285,486 | +3,000 (+1.06%) |
| embed | 677,388 -> 686,221 | +8,833 (+1.30%) | 216,967 -> 219,654 | +2,687 (+1.24%) |
| embed.cpu | 581,479 -> 590,788 | +9,309 (+1.60%) | 185,380 -> 188,336 | +2,956 (+1.59%) |
| full | 921,298 -> 930,607 | +9,309 (+1.01%) | 288,595 -> 291,566 | +2,971 (+1.03%) |

Everything, against the tree before the plugin work:

| bundle | raw bytes | delta | gzip -9 bytes | delta |
|---|---|---|---|---|
| notebook | 654,099 -> 677,128 | +23,029 (+3.52%) | 208,526 -> 216,700 | +8,174 (+3.92%) |
| web | 889,516 -> 912,545 | +23,029 (+2.59%) | 277,195 -> 285,486 | +8,291 (+2.99%) |
| embed | 664,186 -> 686,221 | +22,035 (+3.32%) | 212,082 -> 219,654 | +7,572 (+3.57%) |
| embed.cpu | 568,082 -> 590,788 | +22,706 (+4.00%) | 180,408 -> 188,336 | +7,928 (+4.39%) |
| full | 907,579 -> 930,607 | +23,028 (+2.54%) | 283,452 -> 291,566 | +8,114 (+2.86%) |

The `volume` plugin adds nothing to any bundle: it is a separate file, read by `viewer.py` and inlined
only into a viewer that has a volume payload (`docs/PLUGIN_VOLUME.md`).

The registry, the seam and the painter changes are about 13.7 KB raw and 5 KB gzipped of that per bundle;
rows and legend are about 9.3 KB raw and 3 KB gzipped (8.8 KB raw in the embed, which has no SVG
context). That is a cost in size, not a promise of "free when unused": the guarantee in section 4 is
about behaviour and output bytes. The notebook bundle is inlined into the `.ipynb` once per `show()`
cell when the library is not shared, so it is paid there once per cell.

## 11. What is not established

- **The cost on a real GPU.** Everything ran through SwiftShader. The GPU-side numbers are relative
  (mesh rebuild, edge-instance count), not frame times.
- **Browser probes outside Linux.** `tests/plugin_browser.py` launches through `tests/cdp.py` on a
  Mac and through `PY2DMOL_CHROME` elsewhere; it was run on Linux and Chromium only.
- **Several objects, and an alignment, in a browser.** The arithmetic is tested (`_modelToView` with an
  `alignTransform` against `_transformedFrame`), and `ctx.toView(p, objectName)` picks the object; no
  browser page drew a plugin over two aligned objects.
- **The tube style** draws no plugin geometry (section 7).
- **Visibility of GPU `tri` and `dot`**: residue 0's coverage applies to them (section 8, read in the
  shader and not measured).
- **A notebook with the library borrowed over a BroadcastChannel** (Colab). The plugin script does not
  care whether it runs before the library; the three orders are tested in a page, not through a real
  borrow.
- **GIF and ZIP recordings carry no legend** (section 14): a legend that is on the screen is in the
  DOM only, not in the file.
- **Which painter a PNG export's legend asks for** follows `renderer.gpuDrewLastFrame`, read straight
  after the export's own frame. No test in the suite pins it; the one measurement of it is in section 14.
- **The legend's position and size are fixed** (top left of the viewer's box, at most 30 entries, 60% of
  the width): a viewer whose box is smaller than that clips it.
- **GPU-browser coverage of `tri`, `dot` and `bounds`.** The browser probe draws lines and one ball;
  triangles and bounds are node-tested only.

## 12. Follow-ups, not built

| | needs |
|---|---|
| `volume.js` minified at build time | it is inlined as written, 18,493 bytes per viewer that uses it, against 8,157 minified; a build step needs a manifest entry outside `src/` |
| a tighter fit for a shell than the bounding-box radius | `bounds()` is a box and the registry turns it into a radius, which overshoots; a bounding sphere would be tighter |
| a legend in GIF and ZIP recordings | the legend drawn into each recorded frame, as it is into a PNG |
| `cover` / translucency | a real blend pass in `paintgl.js` |
| a reserved visibility slot for `tri` / `dot` | one extra texel in the visibility texture that no residue owns, and `res` pointing at it |
| a live update channel | `_send_incremental_update` carries `plugins` (a `None` removes: see the set/unset trap in `CLAUDE.md`); `add_plugin` on a live viewer |
| the web app's session path | `src/app/session.js` saves and restores a session without `plugins` |
| the tube style | a seam in `_drawFrame`, or a refusal with a message |
| a separate depth range for plugin geometry | only if the speckle in section 8 matters; it costs a second pass |
| multi-object in a browser | a probe with two aligned objects |
| `remove_plugin`, and what repeated `add_plugin` means | payloads accumulate today; decide replace, append or keyed |
| `_viewInto` timing | `_rotateAt` now goes through it; it is bit-for-bit equal but was not timed on a large structure |
| station / trajectory playback | a plugin whose key moves with the frame rebuilds the mesh per frame; not measured |
| a viewer teardown hook | so `dispose` has somewhere to be called from |

Not proposed: picking or selection of plugin geometry, a plugin marketplace, and any change to how
residues are drawn.

## 13. Tests

Run the node checks with `tests/run.sh node`; the browser probes need Chromium (`tests/README.md`).

| file | lane | claim |
|---|---|---|
| `tests/plugin_seam.js` | node | registry, seam and `paint2d` without a browser: nothing changes without a plugin, colour and depth order reach the canvas, the prim schema, the `apiVersion` messages, registration in every order, the budget (exactly the cap passes, one over draws nothing), a throwing plugin rolls back, the key moves with options / payload / frame, `bounds` and the per-axis floor, `noInk`, `_modelToView` equals `_rotateAt` and applies `alignTransform`, non-finite and absurd coordinates, one cap per painter and the SVG comment, the tube notice, `linesKeyOf` |
| `tests/plugin_state.py` | node | the round trip, unknown names kept and warned about once, a no-plugin page and state file byte-identical to the tree before this change (`--golden`), the page script and its escaping, per-page inlining, validation of every `add_plugin` argument |
| `tests/plugin_browser.py` | gpu | a wireframe in both painters and in PNG / SVG capture, a rotation without a GPU rebuild, the key moving the picture through a rebuild, a cube larger than the structure not clipped, the ball keeping the structure's cheap recolour, three registration orders, the `ink` toggle, a tight fit on both axes, 10,008 strokes with an SVG export that carries the comment |
| `tests/plugin_rows.js` | node | the schema and its refusals (a refusal is an error state, never a throw into the frame), the Style panel of a viewer with no rows byte-identical (against `PANEL_BASE=<tree without plugin rows>` as well), the handler calling `setOption`, values updated in place and only a new shape rebuilt, an off toggle not written as `checked="false"`, the legend element and its 30-entry cap, an export's legend leaving the live viewer's state alone, the SVG context's text and comments valid XML 1.0 (parsed with a real XML parser) |
| `tests/plugin_rows_browser.py` | gpu | rows and legend in a real browser in all three shells (notebook with both painters, web app, embed): the panel byte-identical without rows, one labelled group, a click changing the drawing and the legend, the slider, the legend option, a PNG and an SVG capture carrying the legend once |
| `tests/fakedom.js` | | a DOM just big enough for the panel and the registry's own elements, so `plugin_rows.js` needs no browser |
| `tests/volume_plugin.js` | node | the shipped `volume.js` run in node: payload validation, unique edges, the budget and its stride (the exact formula; both poles of a sphere reached), `key()` on its own, the fit, the error state, the same UTF-16 limit table as Python |
| `tests/volume_state.py` | node | `add_volume` and `meshes_from_grid`: validation before anything is stored, the sign convention, NaN cut on every side, the state round trip, the page, the packaged resource |
| `tests/volume_browser.py` | gpu | the real plugin in both painters on a helix and on 1CRN against a synthetic field: the shells appear, the budget note, the Edges slider, group toggles, an SVG export's legend |
| `tests/packaging.py` | node | every file `viewer.py` opens, `plugins/*.js` included, is in `setup.py`'s package data |
| `tests/bundles.js` | node | every bundle carries `py2dmolPlugins` |

## 14. Rows and legend (R5)

A plugin may define `rows(ctx)` and `legend(ctx)`, and a `title` (the panel group's heading; default the
plugin's name). Both get the usual `ctx` (`options`, `payloads`, `instance`, ...) plus `painter` and
`maxPrims` for it, so a legend can say what the last frame on that painter drew.

**`rows(ctx)`** returns Style-panel rows as data, in the schema of `parts/panel.js`'s
`STYLE_PANEL_ROWS`: a list of rows, each a list of items, restricted to the kinds a plugin can use,
`toggle`, `select` and `range`. Per item: `option` (the plugin option the control reads and writes; the
panel calls `setOption(viewer, plugin, option, value)`), `label`, the current value in `checked` /
`value`, and optionally `title` and `half`. A `select` has `options: [[value, text], ...]`, exactly two
strings each, because a third element would reach `el()`, which reads `html:` as markup; a `range` has
`min`, `max` and `step`. There is no `slot` (a plugin cannot own a div) and no `id` (the panel makes
them). Limits: 100 rows, 8 items a row, 300 characters a label.

**`legend(ctx)`** returns `[{label, color: '#rrggbb', note?, group?}]`, at most 1,000: a swatch and a
label per entry and a heading where `group` changes. Text only: a label is never parsed as markup. The
legend option `legend: false` takes a plugin's legend away.

**Validation.** `P.validateRows` and `P.validateLegend` check the answers. A malformed answer, or one
that throws, is an error state under the painter key `ui` (the badge, the console, `errors()`); the
group and the legend draw nothing, and nothing is thrown into the frame loop. Both are asked again
whenever the registry collects or harvests geometry and whenever `setOption`, `setPayload` or
`register` runs; the whole answer is compared with the last one before the DOM is touched.

**The Style panel.** The registry hands the validated groups to `renderer._syncPluginPanel`, which
`parts/ui.js` sets beside the panel in every shell that builds one (notebook, web app, embed with
`controls`). `parts/panel.js`'s `syncPluginRows` builds ONE labelled `div` as the last child of
`#stylePanel`, and removes it when there is nothing to show. A viewer with no plugin rows never has the
hook called, and its panel is the one `buildStylePanel` always built: `tests/plugin_rows.js` compares
the markup (6,095 characters) with the same code with a rowless plugin registered, and with another
tree's `panel.js` when `PANEL_BASE` names it; `tests/plugin_rows_browser.py` compares a live
`#stylePanel` before and after a plugin it has no payload for registers, in all three shells. The group
is rebuilt when its shape changes (rows, labels, options) and its controls are updated in place when
only values change, because rebuilding under a slider being dragged drops the drag. A toggle that is off
is built with `checked` undefined: `el()` sets an attribute for every defined value and an attribute
named `checked` is a checked box whatever it says.

**The legend on the screen** is one element inside the viewer's own box (`canvas.parentElement`, the same
rule as the error line), `position:absolute` at the top left, absent when there are no entries. It shows
the first 30 entries and then "+N more", and is height-capped and clipped to the box.

**The legend in an exported figure.** The DOM legend is not part of the canvas, so a PNG or SVG capture
draws the legend into its own context through `P.drawLegend` (called from `parts/capture.js` right after
the render): a translucent box (`globalAlpha`, so the SVG carries an `opacity` attribute every editor
reads), then a swatch and a label per entry, as many lines as fit and the last one "+N more". That
needed `fillText` on the SVG context, which had none (`core/svg.js`, serialised as a `<text>` element); a
context without `fillText` draws no legend rather than swatches with no words. GIF and ZIP recordings
carry no legend.

**An export's legend says what that export drew, and asking costs the live viewer nothing.**
`drawLegend` asks `legend()` again, quietly, for the painter that drew the export: the answer is a local
value, with no error state, no badge and no `console.error` on the live viewer, and nothing depends on
the live legend being non-empty. A `legend()` that throws for one painter draws no legend into that
export and says so once, as a console warning. The painter is `'svg'` for an SVG export, which is always
the 2D painter under the 2D cap (so a GPU viewer's SVG can show fewer primitives than its screen); for a
PNG it is `renderer.gpuDrewLastFrame`, read straight after the export's own frame. At ordinary dpi a GPU
viewer's PNG reuses the GPU mesh and the screen's note is right; when the GPU declines a frame the 2D
painter draws the PNG under the 2D cap, and the note follows that flag. Measured once, with a throwaway probe that is not in the suite (a GPU notebook viewer, 598 px, the default
helix): at 96 and 192 dpi `gpuDrewLastFrame` was true and the export asked `legend()` for `'gpu'`; at
1,500 dpi (7,475 px) it was false and the export asked for `'2d'`.

**The SVG context's text is valid XML.** XML 1.0 forbids C0 controls (but tab, LF, CR), U+FFFE, U+FFFF and
an unpaired surrogate, so the context removes them from every text it writes, the legend's `<text>`
elements and the comments alike. `tests/plugin_rows.js` parses the result with a real XML parser.
