# Plugins: a supported way to draw things that are not residues

**Status: the core is built (2026-09-30).** The registry, the seam, both
painters' support, the Python API and the state round trip exist and are
tested; the first plugin (`volume`), the Style-panel rows and the legend do not
(section 9). Every claim here carries a `file:line` or a measurement. What is
NOT established is listed in section 7 rather than assumed, and it includes the
cost on a real GPU.

The design was proposed, then de-risked by spikes, then built; this document is
the as-built version. Where a spike contradicted the proposal, the measured
thing is what is written here.

## 1. Why

A host library (first one: naurmalade, drawing cosolvent free-energy densities
around a protein) needs geometry that is not a residue: an isosurface shell per
probe, labelled site markers, contacts from a marker to a residue. py2Dmol had
no supported way to add it. What a host could do before, measured (1CRN,
`preset="richardson"`, `sidechains=True`, real Chromium via WebGL2):

| route | result |
|---|---|
| markers as `position_types='L'` atoms in the protein's object | draws, coloured per position, focus and side chains coexist, marker-to-residue lines via `add_contacts` |
| marker size | **fixed by element**: a lone atom's radius is its full vdW radius (`src/cartoon/geom.js` `loneAtomRadiusA`); smallest is H at 1.2 A. There is no per-marker radius argument |
| points closer than ~2 A | grow sticks: bonds are derived by distance |
| `set_opacity` on markers | a 4x4 ordered **dither**, not alpha; at 0.35 it reads as a grey moire hatch, and a nearer sphere still hides a farther one |
| density as a point cloud | credible only at ~60-100 solid, sparse points; ~200 already occludes the protein, 1000 buries it |
| extra per-object payload through `save_state` | **dropped**: `save_state` is a whitelist for objects; an unknown key is gone after `load_state`. Side finding: `sidechain_atoms` is not in the saved JSON either |

So a density view needs the renderer's help. This is the smallest supported
surface that gives it, and it is not specific to density.

## 2. What exists, and the seams

- **Parts** (`window.py2dmolMolParts`, `src/core/mol.js` `installMolParts`) copy
  methods onto the renderer prototype. Nothing calls them from `render()`, so a
  part can add a method but cannot draw. And the registry is **sealed by the
  first viewer**: `parts.push` then throws, and the notebook prepends scripts, so
  load order there is reversed. **A plugin therefore does not use it.**
- **The primitive list** is built inside `render()` (`src/cartoon/geom.js`;
  `const prims = []`) from `rib`, `line`, `tube`, `stickFace`, `ribStroke`,
  `joint`, `dot`. Both painters draw that one list (`paint2d.js` to a canvas,
  `paintgl.js` to WebGL2), z-sorted. There is **no triangle primitive** and no
  alpha blending. The GPU painter reaches the list through `_probeOnly`: it
  sets it, `render()` returns at the sort, and `facesOf` turns the prims into a
  mesh that is then drawn from a camera uniform until the signature changes.
- **Registration and inlining**: `MODULES` in `tools/bundle.py` is the
  manifest; `viewer.py` inlines the built bundle into the HTML.
- **Capture** (`src/parts/capture.js`, `src/core/svg.js`) draws from the same
  prim list, so anything in it is captured for free.

## 3. Requirements, and where each is met

| | requirement | as built |
|---|---|---|
| R1 | a plugin contributes geometry both painters draw, depth-sorted with the cartoon, and captured | `collect()` at the seam in `geom.js`; `tests/plugin_seam.js` (2D, depth sort) and `tests/plugin_browser.py` (both painters, PNG and SVG capture) |
| R2 | registration at any time; late registration must not throw | `parts/plugins.js` is a plain object created-if-absent on BOTH sides; a stub parked before the bundle is adopted by it; `register()` after a viewer is up binds and redraws it |
| R3 | data from Python, in the page, through `save_state`/`load_state`, unknown plugins kept verbatim with a warning | viewer-level `state["plugins"]`; one warning per load naming every unknown name; `tests/plugin_state.py` |
| R4 | zero cost and zero change with no plugin | no-plugin `to_html()` and `save_state()` are byte-identical to before (golden recorded from the pristine tree); `tests/paint_trace.js` digest unchanged (11 fixtures, 26,703 ops); `key`/`collect`/`extent` on a viewer with no plugin cost 8-13 ns a call; size in section 3a |
| R5 | Style-panel rows, legend, no DOM outside the viewer | **not built** (section 9). The one DOM element the core adds is the error line inside the viewer's own box |
| R6 | `apiVersion` checked, with a message | `register()` compares with `PLUGIN_API_VERSION` (1) and refuses by name, with both versions and what to do; a missing `apiVersion` is refused too. **A refusal never throws**, wherever it happens (a direct call, or a definition parked before the bundle - a throw at load time would kill the whole bundle): it is recorded in `py2dmolPlugins.rejected`, said once on the console, and `register()` returns `null` |
| R7 | geometry budgeted, refused loudly | `ctx.maxPrims` per painter; overrunning **throws** (section 4) |

### 3a. R4: what the registry costs in bytes

**Terser is not available here, so nothing below is a minified measurement.**
Run `python3 tools/bundle.py build` and quote the real numbers.

*Measured (plain arithmetic on source text):*
- `src/parts/plugins.js` is **30,948 bytes**, 646 lines, most of it the comments this
  project writes; with comments and indentation stripped (what a minifier removes
  first) it is **16,539 bytes**.
- All the JavaScript this work changed - `plugins.js` plus the seam, `_viewInto` /
  `_modelToView`, the `paintgl`/`paint2d` guards, `svg.js`'s `comment`, `orient.js`'s
  floor - comment-stripped, (new - old) summed over the modules each bundle
  contains: **19.0 KiB** in notebook, web and full; **18.6 KiB** in embed and embed.cpu.
- That against the tracked (real, minified) bundles, in bytes: notebook 654,099 ->
  **2.97%**; web 889,516 -> 2.19%; full 907,579 -> 2.14%; embed 664,186 -> 2.87%;
  embed.cpu 568,082 -> **3.35%**. This compares STRIPPED SOURCE with MINIFIED output,
  so it is an upper bound on the added bytes: mangling names takes a further
  30-40% off the added code.
- The unminified stand-ins (the same concatenation as `tools/bundle.py`, no terser):
  3,109,613 notebook, 4,031,132 web, 3,135,308 embed, 2,698,476 embed.cpu and
  4,086,613 full bytes.

*Estimated (assumptions, not measured):* the added code minifies to about 60-70% of
its stripped size - **plugins.js about 10-11 KB minified, about 3.5-4.5 KB
gzipped**, and everything changed **about 11-13 KB minified** (60-70% of the 19.0 KiB
stripped delta), which is **about 1.7-2.0% of the 654 KB notebook bundle**. Over the
wire the figure is an UPPER BOUND of **at most about 2.9%**: the gzipped stripped delta
is 5.9 KiB (names unmangled) against the tracked notebook bundle's 208,550 B gzipped.
Replace all of these with real numbers after `tools/bundle.py build`. The notebook
bundle is inlined into the .ipynb once per `show()` cell when the library is not
shared, so the registry is paid there once per cell.

## 4. The API as built

### Python

```python
py2Dmol.register_plugin(name, js_source, version=None)   # external JS, inlined per page
v = py2Dmol.view(...)
v.add_plugin(name, payload, object=None, frame=None, options=None,
             version=None, api_version=None)              # chainable
v.set_plugin_option(name, key, value)
```

- `payload` is anything `json.dumps` takes - **NaN and sets are refused at the
  call**, not in the page - and it is **copied** at add time.
- The payload lives on the **viewer** (`view._plugins`, `state["plugins"]`), never
  on an object: the object whitelist in `save_state` drops an unknown per-object
  key, which `tests/plugin_state.py` keeps as a control.
- `object` binds it to an object by name (as `add_contacts` does); `frame` to a
  frame; `None` means "whatever is drawn".
- Sent with `show()`. **A viewer already on the page does not see a later
  `add_plugin`** - it warns once and the payload appears when the viewer is shown
  again (section 9: the live channel).
- **`register_plugin`'s trust model**: the plugin's JavaScript is INLINE SCRIPT
  in the HTML page the reader opens, exactly like the core. There is no sandbox
  and none is promised. It is inlined, once per page, for every viewer that
  carries a payload for that name, in every bundle mode (inline, external,
  shared-library).
- **The `</script` limit**: a source containing `</script` (any case) or `<!--`
  is **refused with `ValueError`**, not escaped - escaping is only safe inside a
  string and the function cannot know where in the code it is. Write
  `"<\/script>"` or `"<" + "!--"`. The *payload* needs no such care: every `<` in
  it is written as the six-character escape `\u003c`, which JSON and JavaScript
  both read back as `<`.
- Names match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}` (they become an attribute and a
  state-file key).

### JavaScript

```js
(function () {
  // works whether it runs before or after the viewer library
  var P = window.py2dmolPlugins = window.py2dmolPlugins || {list: [], pending: []};
  var def = {
    name: "volume", version: "0.1", apiVersion: 1,
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

`prims(ctx)` is called inside `render()`, after the depth range and before the
filters and the sort. **A plugin draws in a viewer only where that viewer has a
payload for it** (or JS called `P.setPayload(renderer, name, data)`); a plugin
registered on a page with three viewers costs the other two nothing.

`ctx` holds `renderer`, `host`, `instance` (what `init` returned), `name`,
`version`, `apiVersion`, `options`, `payloads` (`[{object, frame, payload,
index}]` - only those that apply to what is drawn NOW), `frame`, `maxPrims`,
`painter` (`'2d'`/`'gpu'`), `scale`, `toView(p, objectName?)`, `project(x,y,z)`,
and three helpers, so a plugin never hand-builds a prim:

| helper | emits | notes |
|---|---|---|
| `ctx.line(a, b, {color, width, ink})` | `kind:'line', pts, x1,y1,x2,y2, z, w, wA, zBias:0, c, flat:true, pA, pB, sel:false, joints:[null,null], noInk` | `width` in Angstrom, default 0.35. `joints` is REQUIRED: a line without it throws in `paint2d` at ink time (`tests/plugin_seam.js` keeps that as a control) |
| `ctx.dot(p, {color, radius, ink})` | `kind:'dot', x1,y1,z, r, rA, c, pA, sel:false, noInk` | `radius` in Angstrom, default 0.5 (D3) |
| `ctx.tri(a, b, c, {color})` | the existing `joint` prim: `q:[A,B,C], nl, two:true, gs0:-1, resId:0, c, noInk` | opaque, flat-shaded, double-sided; only `nl` (the GPU drops `unlit`) |

Points are **model space** (the coordinates of the file); `toView` maps them
through the object's `alignTransform`, its own rotation and the viewer's - the
same arithmetic `_rotateAt` does for a position (`core/mol.js` `_viewInto`, one
copy; `_modelToView` is its door). Colour is `[r,g,b]`, `{r,g,b}` or `'#rrggbb'`.
Plugin prims are **`noInk` by default** (no dark rim; pass `ink: true` to get one).

**Near plane.** Under perspective, a point behind the camera or within 0.1 A of
it makes its primitive return `false` and be dropped whole (under ortho nothing
is behind the camera). **Near-plane clipping is not done.**

**Non-finite and absurd coordinates.** `ctx.line/dot/tri` return `false` and drop
the primitive when a coordinate is NaN or infinite, or when the point lies more
than **50x the structure's extent (never less than 500 A)** from the view centre
- a finite `1e30` is as bad for the GPU depth range as `Infinity`, because it
would stretch the range until the cartoon collapsed into one depth step. Nothing
non-finite ever reaches a painter or the depth range. The plugin still draws
the rest of the frame, and is put in an error state that counts what it dropped
("5 primitives dropped: a coordinate was not finite, or lay more than 1500 A from
the view centre"), once per frame on the console. `bounds()` is held to the same
rule: a box with such a corner is ignored, and is an error.

**Depth.** A plugin's triangle or ball can lie outside the structure's depth span,
which is what the 2D painter normalises `near` over; `near` is **clamped to 0..1
for plugin prims** (as the GPU clamps `near01`), so with depth fade they stay
inside their colour ramp instead of extrapolating to paper-white behind and past
their own colour in front.

**`register()`.** Returns the registered definition, the existing one (same name
and version, idempotent), or `null` for a refusal - it does not throw. The
registry is **idempotent to a second evaluation**: `py2dmolPlugins.__impl` marks
the real implementation and the state (`__core`: which viewers exist, what they
hold) lives on the registry object, so a second notebook cell that carries its own
copy of the library changes nothing and runs `init` once per viewer.

**`dispose`** is called on a plugin being **replaced** (same name, new version).
**There is no viewer teardown hook to call it from** - a viewer has no destroy -
and none was invented: a plugin must not rely on `dispose` for cleanup when a
viewer goes away.

**`key()`** is how the GPU finds out a plugin moved. The registry's combined key
folds, per plugin: its name and version, a revision counter, the viewer's
options, which payloads apply to this frame, and the plugin's own `key(ctx)`. It
goes into `sharedGeometryKey` in `paintgl.js` - so into both the full and the
topological signature - and is `''` with no plugin.

**`bounds(ctx)`** joins the fit-to-view: the registry turns the box into a radius
about the view centre (the same at every rotation), and `_viewHalfSpan` never
lets the **fitted** span be smaller than it. It only ever grows the span, and the
reader's zoom still divides it.

**The rule: the floor applies to the fit, not to a span somebody set.** orient,
focus and the app write a tight target through `setViewSpan`
(`viewerState.extent`). Flooring that at the plugin's radius would stop a focus on
one residue from zooming closer than a shell drawn around it - the naurmalade
case. So `_viewHalfSpan` applies the floor only while `viewerState.extent` is
unset, and the span an **orient to everything** writes (`parts/orient.js`; the
opening orient of every viewer is one, and it sets a span) carries the floor
itself, widened by how far the centre moves. A selection is not everything and
gets the tight span it asked for; "orient to all" frames the plugin again.

**The floor is per AXIS** (`floorViewSpan` in `orient.js`). A span is stored as
`(extent, aspect)`: `extent * aspect.x` and `extent * aspect.y` are the two
half-spans, the STORED aspect normalised so its larger part is 1. Raising the extent alone
raises the long axis by the same factor as the short one, and for an elongated
structure (aspect 0.053 : 1, the 88 A test helix) a 45 A floor on the short axis
pushed the long one to 853 A - 19x what was needed. So each half-span is raised to
the floor and written back as (larger, ratio); the representation is unchanged, and
a span that already holds the floor is returned as it was.

Consequences. A plugin that arrives after the opening orient is framed at the next
orient to everything, not at once. **`parts/multi.js` reframes without the floor:**
it writes `setViewSpan(..., maxExtent)` on an object switch, on leaving multi and on a
merge, which drops the plugin floor until the next orient to everything (a known gap;
the floor is not re-applied there).

**The registry's guard is `__impl >= IMPL`.** A page can carry bundles of different
ages; the same or a newer registry already on the page wins and the file does
nothing, so an older bundle loaded afterwards cannot downgrade it. An older (or no)
registry is taken over: its registered plugins are kept, its per-viewer state is
started afresh, and a viewer re-attaches on its next question.

### maxPrims: THROW, not truncate

Defaults, from the spikes: **2D 8,000, GPU 60,000** (`window.py2dmolPlugins.caps`
can be changed by the host before a viewer renders). A plugin that emits one
more throws `PluginBudgetError` from the helper; `collect()` catches it and
**drops that plugin for the frame - nothing of it, not a truncated 8,000** - then
says so: the console (once per viewer), a one-line badge inside the viewer's own
box, and `py2dmolPlugins.errors(renderer)`. The state clears on the next frame
that fits. Other plugins are unaffected. A plugin that throws for any other
reason gets the same treatment and adds nothing - its earlier prims in that frame
are rolled back. The message names the plugin, the cap and both painters'
caps and says what to do.

**One cap and one error state per painter** (`errors()` entries carry `painter`:
`'2d'`, `'gpu'`, `'svg'` or `'load'` for init/setPayload/key/bounds). The GPU
harvests geometry under `_probeOnly`; an **SVG export is always the 2D painter**
whatever painter the viewer has, so it is held to the **2D cap** - a 10,008-line
shell the GPU draws is over it. Such an export cannot show a badge, so it says so
**in the file**: an XML comment `<!-- py2dmol plugin <name> not drawn: <message>
-->` (`C2S.comment`; `--` and `<>` in the message are flattened so the file stays
valid XML), and once on the console. Error states are **not in the registry key**
(that would make an export that overran move the next GPU signature and force two
rebuilds); the **caps are** - a changed cap is a different mesh. A raster export
through the 2D painter (PNG on a 2D viewer) has no annotation layer and uses the
same cap as the screen, where the badge shows it.

**The tube style** draws no plugin (it never reaches `geom.js`'s `render()`). It
says so once per viewer on the console, naming the plugin; it does not draw.

**The reach cap is not configurable.** A plugin primitive more than 50x the
structure's extent (never less than 500 A) from the view centre is dropped. Only
`P.caps` (the primitive budgets) is a knob: the reach cap exists to protect the
GPU depth range from one absurd coordinate, and a setting that could raise it would
hand the same hazard back - a legitimate shell is never that far from its structure.

The caps are a *decision*, not a measurement of a limit: the 2D painter was
still interactive at ~7,700 lines (spike: 43 ms median JS per frame) and the GPU
mesh took 46,000 lines through one build. **Neither was measured on a real GPU.**

### State

`save_state` gains a top-level `plugins` only when there is something:

```json
"plugins": {"volume": {"version": "0.1", "apiVersion": null,
  "options": {"level:-1.0:visible": true},
  "payloads": [{"object": "crn", "frame": 0, "payload": {...}}]}}
```

It round-trips through `load_state` -> `save_state`. A name the loading process
has not registered is kept **verbatim** and warned about **once** (one warning
naming every unknown name). In the page it is `window.py2dmol_plugins['<id>']`,
a sibling of `py2dmol_configs`.

## 5. What the spikes corrected, and what was built for it

| spike finding | what it means for the build |
|---|---|
| **GPU depth range.** `resident.zMin/zMax` (= +-`rad`) is sized from the faces' corners only. A line reaching past it is clipped in NDC depth: a shell larger than the structure loses its near and far sides | `buildMeshPart` folds a **plugin** stroke's model-space extent into `rad` (`lineRad2`; plugin strokes only - a contact never reached past its faces and must not start now). It reaches `tailRad` through `part.rad`. **Regression: a cube larger than the structure is 6,308 px on the 2D painter (no depth range) and 3,055 px on the GPU without the fold (0.48), 6,444 vs 6,308 (1.02) with it** |
| **`signatureOf` had no plugin term** (the negative control proved a plugin never appears otherwise) | the registry key is in `sharedGeometryKey`, hence in both keys |
| **`noInk`**: a plugin stroke must not get a dark rim, and must not reach further as an occluder than it is drawn | per prim: GPU skips the border ink instance (`putContact(c, 4, ...)`), 2D skips the ink stroke in the line and dot branches and uses the painted extent in both occluder grids |
| **`bounds`**: a shell outside the structure is cut off by the canvas | `bounds(ctx)` and `_viewHalfSpan` (above) |
| **`noInk` is part of what a GPU line IS**: the group-1 mesh part is cached under `ribbonHashOf(face) ^ linesKeyOf(lines)` | `linesKeyOf` mixes `noInk` and `plugin` (only when set, so a contact's hash is what it was). Without it flipping `ink` with unchanged geometry handed back the cached part with the old rim in it (GPU: 0 px differ; `tests/plugin_browser.py`) |
| **`near` can fall outside [0,1] for plugin prims** (the structure's span, unclamped) | clamped in `paint2d` for `plugin` prims |
| **per-object keys are dropped by the `save_state` whitelist** | payload is viewer-level |
| **`line` without `joints` throws in `paint2d`** | `ctx.line` fills the whole schema |
| **per-painter budgets** | `maxPrims` by painter |
| **the notebook prepends scripts and the registry is sealed** | `py2dmolPlugins` is its own object, created if absent on both sides, with a `pending` stub |

**The side effect of the depth-range fold on the cartoon**, measured (1CRN,
Richardson, GPU, one 0.4 A stroke, no `bounds` so the fit is unchanged; ON vs OFF
in the same page; OFF twice differs by **0 px**, so there is no noise floor to
subtract; pixels within 4 px of the stroke are excluded; ~50,800 ink px):

| stroke at | cartoon px changed | max channel delta |
|---|---|---|
| R = 3 A (inside the structure) | 6 | 91 |
| R = 14 A (at the structure's radius) | 0 | 0 |
| R = 40 A (2.9x the radius) | **610** (1.2% of ink px) | 127 |

2D painter: 20, 0, 0 (same three radii). The 610 are scattered single pixels along ribbon edges and
a patch in the overlap of two coincident surfaces (mean luminance -21), which is
what a 2.9x wider depth range does to tie-breaks - the same kind of change, and a
similar size, as the 0.48% of pixels the `prims.sort` removal costs
(`cartoon/geom.js`). **The least-bad handling is the one built**: the range only
grows when a plugin stroke actually reaches past the structure (R = 14 is free),
only on the GPU, and only in the viewers that have a plugin. A separate depth
range for plugin geometry would cost a second pass for something that is a
speckle at ties. (The spike measured 813 px with a cube at R = 16 about 1UBQ.)

## 6. Decisions, settled

- **D1. External JS registration: included.** `py2Dmol.register_plugin`. It is the
  same registry; the price is the trust statement above (inline script in an HTML
  page, exactly like the core) and the `</script`/`<!--` refusal. Evidence: a
  plugin script ahead of the library, after it, and registered from the console
  after the viewer is drawing all draw (`tests/plugin_browser.py`, both painters).
- **D2. Wireframe first, opaque `tri` through the existing `joint` prim, no
  `cover` in v1.** `tri` needed no painter work (the spike built a solid sphere
  from 1,280 of them; the node test checks the prim shape). An opaque triangle is
  lit by its own `nl` only.
- **D3. Sphere with a caller radius: a `dot` option, not a new kind.** `dot`
  already carries `rA`; `ctx.dot(p, {radius})`. On the GPU a plugin dot has **no
  palette slot and needs none**: its colour is baked (`pal: -1`), so recolouring
  the structure leaves it alone, and it does not flip `__gpuPaletteComplete`
  (which would turn every recolour of the STRUCTURE into a rebuild). Checked in
  `tests/plugin_browser.py`; removing the exemption fails it. **A reserved
  visibility slot is NOT built** (section 7).
- **D4. Translucency: out of v1.** The dither measured ugly at 0.35; wireframe
  covers the density use case.

## 7. What was NOT established

- **The cost on a real GPU.** Everything ran through SwiftShader (no GPU on the
  box). The GPU-side numbers are relative (mesh rebuild, edge-instance count),
  not frame times.
- **The minified bundles.** `tools/bundle.py build` needs `npx terser`, absent
  here. The five tracked `.min.js` and `dev.html` are **not regenerated**: the
  maintainer runs `python3 tools/bundle.py build`, then `bundle.py check`. Until
  then `tests/bundles.js` (does each bundle define `py2dmolPlugins`) and
  `bundle.py check` (`dev.html` lacks the new tag) are meant to fail, and
  `tests/plugin_browser.py` runs on an unminified stand-in built from the same
  manifest (it says which it used). With stand-ins of all five in a scratch copy,
  `bundles.js` reports every bundle `py2dmolPlugins` present; only its
  README-size checks fail (unminified).
- **Mac-only probes.** `tests/plugin_browser.py` launches through `tests/cdp.py`
  on a Mac and through `PY2DMOL_CHROME` elsewhere; it was run on Linux only.
- **Several objects, and an alignment, in a browser.** The arithmetic is tested
  (`_modelToView` with an `alignTransform` against `_transformedFrame`), and
  `ctx.toView(p, objectName)` picks the object; no browser page drew a plugin
  over two aligned objects.
- **The tube style.** Plugins draw through `cartoon/geom.js`'s `render()`; the
  tube style does not go through it, so a viewer in tube style draws no plugin
  geometry. It now **warns once per viewer** (console), naming the plugin; it does
  not draw.
- **Visibility of GPU `tri` and `dot`** (read, not measured): a GPU face carries
  a residue id, and the fill shader clamps it into the visibility texture, so a
  plugin's triangles and balls take the coverage of residue 0. Plugin **lines**
  are edge instances with residue -1 (full coverage) and are immune. This is the
  reserved visibility slot of section 9.
- **A notebook with the library borrowed over a BroadcastChannel** (Colab). The
  plugin script is written so it does not care whether it runs before the
  library; the three orders are tested in a page, not through a real borrow.

## 8. Tests, and what each is for

| file | lane | claim |
|---|---|---|
| `tests/plugin_seam.js` | node | R4 (empty registry, unattached plugin, empty plugin all draw byte-identically), R1 (colour reaches the canvas, where it was projected, depth sort), the prim schema, R6 messages, R2 (before the bundle, after, after a viewer is up, twice, a refused one does not stop the bundle loading), R7 (exactly the cap passes; one over draws nothing, names the plugin and cap, logs once per viewer, clears), a throwing plugin rolls back, the key moves with options/payload/frame/own key, `bounds` grows the fitted span at every rotation and zoom and leaves a span orient/focus set alone, `noInk`, `_modelToView` == `_rotateAt` bit for bit and applies `alignTransform` exactly as `_resolvedFrame` does, a refusal is the same parked or direct, the library evaluated twice (`init` once per viewer, late register redraws all), `near` clamped for faces and balls, the per-axis floor (an elongated, a square and a near-square span; the isotropic control reaches 852 A), an older registry cannot replace a newer one, non-finite and absurd coordinates never reach a painter, one cap per painter with the SVG comment and an unmoved key, the tube notice, `linesKeyOf` |
| `tests/plugin_state.py` | node | round trip, unknown names kept and warned about once, no-plugin page and state file byte-identical to the pristine tree's (`--golden`), the page script, escaping, per-page inlining, validation of every `add_plugin` argument (`object`, `frame`, `api_version`, `version`) with no half-made entry left behind |
| `tests/plugin_browser.py` | gpu | a wireframe in both painters and in PNG (and SVG) capture; survives a rotation with no GPU rebuild; disappears and returns with the key, through a rebuild; a cube larger than the structure is not clipped; a plugin ball does not cost the structure its cheap recolour; three registration orders; the `ink` toggle on the GPU (the rim appears and goes); the fit is TIGHT on both axes (between the shell radius and 1.2x the larger of the structure and the shell) on the default helix and on 1CRN, every wireframe check asks for at least 1,000 red px at 600 px, nothing is cropped at the canvas edge, and a focus is tight; 10,008 strokes on the GPU with an SVG export that carries the comment and does not rebuild |

**Every guard has a mutation that fails it**, run under the commit-free protocol
(back the file up, mutate, run, restore from the backup, `diff` to prove it):

| mutation | fails |
|---|---|
| `geom.js` seam call removed | 23 lines of `plugin_seam.js` |
| `apiVersion` check disabled | R6 (5) |
| `maxPrims` throw disabled | R7 (8) |
| `joints: [null, null]` removed | the schema check |
| `_modelToView` skips `alignTransform` | the alignment check (worst 12.4) |
| `paint2d` ignores `noInk` | the `noInk` check (3,280 vs 3,280 ops) |
| `_viewHalfSpan` ignores `extent` | `bounds` (10.0 vs 40.2) |
| `register()` does not redraw live viewers | R2 late |
| a throwing plugin's prims not rolled back | 4 |
| `save_state` drops `plugins` / `load_state` ignores it / the page writes a script unconditionally / `<` not escaped | `plugin_state.py` (1 / 3 / 3 / 1) |
| registry key out of `sharedGeometryKey` | `plugin_browser.py` (3): the wireframe stays after the option changes |
| plugin extent out of the depth range | `plugin_browser.py`: 3,055 vs 6,308 px, ratio 0.48 |
| plugin dot exempt from `palComplete` removed | `plugin_browser.py` |
| `linesKeyOf` without `noInk` / without `plugin` | `plugin_seam.js` (1 / 1); in a browser `ink:true` on the GPU changes 0 px |
| the second evaluation of `plugins.js` not a no-op | `plugin_seam.js`: `init` runs 4 times for 2 viewers |
| SVG context not recognised / its comment not written / an SVG overrun in the registry key / the cap out of the key | `plugin_seam.js` (2 / 1 / 2 / 1) |
| `near` clamp removed for balls / for triangles | `plugin_seam.js` (2 / 2): channels reach 1684 and -1171 |
| floor applied over a span that was set / orient-to-all without the floor | `plugin_seam.js` (2); `plugin_browser.py` (6: the shell is cropped, 108 px at the edge) |
| the finite and reach checks removed (together; each alone is covered by the other for NaN) / reach only / a NaN `bounds()` | `plugin_seam.js` (4 / 4 / 1) |
| `register()` throws on a refusal | `plugin_seam.js` crashes at the first refusal |
| the isotropic floor back in `floorViewSpan` | `plugin_seam.js` (4: 852 A on the long axis); `plugin_browser.py` on the default helix (20: the cube covers 26 px) and on 1CRN (4) |
| guard `=== IMPL` instead of `>= IMPL` | `plugin_seam.js` (2) |
| `add_plugin` type checks off | `plugin_state.py` (4) |

## 9. Follow-ups (not built)

| | needs |
|---|---|
| the `volume` plugin | naurmalade's consumer, section 10; a mesh payload, wireframe per level, optional `tri` |
| Style-panel rows and legend (R5) | `rows()`/`legend()` in the def, and a mount in `parts/panel.js`; touches no DOM outside the viewer |
| `cover`/translucency | a real blend pass in `paintgl.js` (D4) |
| a reserved visibility slot for `tri`/`dot` | one extra texel in the visibility texture that no residue owns, and `res` pointing at it |
| a live update channel | `_send_incremental_update` carries `plugins` (a `None` removes - see the set/unset trap in CLAUDE.md); `add_plugin` on a live viewer |
| the web app's session path | `src/app/session.js` saves and restores a session without `plugins` |
| the tube style | a seam in `_drawFrame`, or a refusal with a message |
| a separate depth range for plugin geometry | only if the 1.2% speckle matters; it costs a second pass |
| multi-object in a browser | a probe with two aligned objects |
| `remove_plugin`, and what repeated `add_plugin` means | payloads accumulate today; decide replace vs append vs keyed |
| `_viewInto` timing | `_rotateAt` now goes through it; time it on a large structure (bit-for-bit equal, not timed) |
| GPU-browser coverage of `tri`, `dot` and `bounds` | the browser probe draws lines and one ball; triangles and bounds are node-tested only |
| station / trajectory playback | a plugin whose key moves with the frame rebuilds the mesh per frame; not measured |
| a viewer teardown hook | so `dispose` has somewhere to be called from |

## 10. The first plugin: `volume` (naurmalade's consumer)

Specified so the API was judged against a real user; implemented after the core.

- **Payload is a mesh, not a grid.** The host extracts isosurfaces (marching
  cubes, in Python, at the requested levels) and sends vertices, faces and a
  colour per level. JS stays a thin renderer; no marching cubes or DX parsing in
  the browser.
- Per level: one shell. Default rendering is **wireframe** (`ctx.line` from the
  mesh edges) because it needs no blending and does not hide the protein;
  optional solid `ctx.tri`, opaque.
- Style rows: per probe/level visibility, wire vs solid; legend entries with the
  probe colour and the level in kcal/mol.
- Budget: the host decimates to `maxPrims`; the plugin reports how many prims it
  emitted (the core tells it the cap, and refuses to exceed it).

## 11. Not proposed

Picking/selection of plugin geometry, live-updating payloads (beyond section 9),
a plugin marketplace, alpha blending, and any change to how residues are drawn.
