# Plugins: a supported way to draw things that are not residues

**Status: the core is built, and so are the Style-panel rows, the legend and the first
plugin, `volume` (2026-09-30).** The registry, the seam, both painters' support, the Python
API and the state round trip exist and are tested (sections 3-8); so do R5 (a plugin's
rows and legend, section 4) and `volume` (section 12). Every claim here carries a `file:line` or a
measurement. What is NOT established is listed in section 7 rather than assumed, and it
includes the cost on a real GPU.

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
| R5 | Style-panel rows, legend, no DOM outside the viewer | `rows(ctx)` and `legend(ctx)` in the definition (section 4, "Rows and legend"); the registry validates them and `parts/panel.js` mounts the rows in all three shells; the legend is one element inside the viewer's own box (and, like the error line, the only DOM the core adds). `tests/plugin_rows.js` (fake DOM), `tests/plugin_rows_browser.py` (real pixels, notebook x 2 painters, web, embed) |
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

**Measured on the real build** (`tools/bundle.py build`, terser 5.51.2 via `bun x`;
the same toolchain rebuilds the pristine tree byte-identical to the bundles committed
on main, so these deltas are only this work). Bytes, before -> after, and gzip -9:

| bundle | raw | delta | gzip -9 | delta |
|---|---|---|---|---|
| notebook | 654,099 -> 667,644 | +13,545 (+2.07%) | 208,360 -> 213,466 | +5,106 (+2.45%) |
| web | 889,516 -> 903,061 | +13,545 (+1.52%) | 276,925 -> 282,179 | +5,254 (+1.90%) |
| embed | 664,186 -> 677,388 | +13,202 (+1.99%) | 211,706 -> 216,712 | +5,006 (+2.36%) |
| embed.cpu | 568,082 -> 581,304 | +13,222 (+2.33%) | 180,265 -> 185,205 | +4,940 (+2.74%) |
| full | 907,579 -> 921,123 | +13,544 (+1.49%) | 283,236 -> 288,310 | +5,074 (+1.79%) |

So the registry plus the seam and the painter changes cost about **13.5 KB raw, about
5 KB gzipped** per bundle. This replaces the 1.7-2.0% estimate given before the build,
which was a little low (the real raw cost on the notebook bundle is 2.07%). It is a
measured cost, not "zero when unused": R4 holds for behaviour and output bytes (paint
digests, `to_html`, `save_state`), not for bundle size. The notebook bundle is inlined
into the .ipynb once per `show()` cell when the library is not shared, so the registry
is paid there once per cell.

**R5's own cost** (rows, legend, validation, `drawLegend`, `syncPluginRows`, the hook in `parts/ui.js`,
the capture calls and `fillText` on the SVG context), measured the same way - the real build
(`tools/bundle.py build`, terser 5.51.2) of the tree with R5 against the tree without it, bytes and
gzip -9:

| bundle | raw | delta | gzip -9 | delta |
|---|---|---|---|---|
| notebook | 667,644 -> 677,128 | +9,484 (+1.42%) | 213,466 -> 216,520 | +3,054 (+1.43%) |
| web | 903,061 -> 912,545 | +9,484 (+1.05%) | 282,179 -> 285,273 | +3,094 (+1.10%) |
| embed | 677,388 -> 686,221 | +8,833 (+1.30%) | 216,712 -> 219,512 | +2,800 (+1.29%) |
| embed.cpu | 581,304 -> 590,788 | +9,484 (+1.63%) | 185,205 -> 188,198 | +2,993 (+1.62%) |
| full | 921,123 -> 930,607 | +9,484 (+1.03%) | 288,310 -> 291,301 | +2,991 (+1.04%) |

So R5 adds about **9.5 KB raw, 3.1 KB gzipped** per bundle on top of the core's 13.5 KB / 5 KB, and
the notebook's total plugin machinery is now about 23 KB raw / 8.1 KB gzipped (the review fixes - the export legend,
its height cap, XML-safe text - added 0.8 KB raw to the first R5 build). The `volume` plugin
itself is in no bundle (section 12). The registry's per-frame cost for a viewer with no plugin is
unchanged: `collect` returns before it reaches `refreshUI`, which only a viewer with an entry calls.
`tests/paint_trace.js` is unchanged (11 fixtures, 26,703 ops).

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
    title: "Volume",                        // optional: the heading of the plugin's panel group
    rows(ctx)       { return [[{kind: "toggle", option: "shown", label: "Shell", checked: true}]] },
    legend(ctx)     { return [{label: "ACE -1.0", color: "#ff00ff", note: "...", group: "ACE"}] },
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

### Rows and legend (R5)

A plugin may define `rows(ctx)` and `legend(ctx)` (and a `title`, the panel group's heading;
default the plugin's name). Both are called with the usual `ctx` (`options`, `payloads`,
`instance`, ...) plus `painter` (the viewer's own, `'2d'` or `'gpu'`) and `maxPrims` for that
painter, so a legend can say what the last frame on THIS painter drew.

**`rows(ctx)`** returns Style-panel rows AS DATA in the schema of `parts/panel.js`'s
`STYLE_PANEL_ROWS`: a list of rows, each a list of items. Only the kinds a plugin can use,
`toggle` (a checkbox that looks like a button), `select` and `range` - no new widget kind was
needed, a per-mesh visibility toggle is a `toggle` - and per item `option` (the plugin option
the control reads and writes; the panel calls `setOption(viewer, plugin, option, value)`),
`label`, the CURRENT value in `checked` / `value`, and optionally `title` and `half`. A
`select` has `options: [[value, text], ...]` (exactly two strings each: a third element would reach `el()`, which reads `html:` as markup); a `range` has `min`, `max`, `step`. There is no
`slot` (a plugin cannot own a div) and no `id` (the panel makes them: `pl-<viewer>-<group>-<n>`).
Limits: 100 rows, 8 items a row, 300 characters a label.

**`legend(ctx)`** returns `[{label, color: '#rrggbb', note?, group?}]` (at most 1,000): a swatch
and a label per entry, a heading where `group` changes. Text only - a label is never parsed as
markup. The DOM legend shows the first 30 entries and then "+N more", and is height-capped and
clipped to the viewer's box; a legend drawn into a PNG or SVG keeps its box inside the image the same
way (as many lines as fit, the last one "+N more").

**Validation, and what a refusal is.** `P.validateRows` / `P.validateLegend` check both; a
malformed answer, or one that throws, is an error state under its own painter key `ui` (the
badge, the console, `errors()`) and draws nothing of the panel group or the legend - never a throw
into the frame loop. `P.errors(r)` reports it.

**Where it mounts.** The registry hands the validated groups to `renderer._syncPluginPanel`, which
`parts/ui.js` sets beside the panel in every shell that builds one (notebook, web app, embed with
`controls`); `parts/panel.js`'s `syncPluginRows` builds ONE group - a labelled `div` - as the last
child of `#stylePanel`. A viewer with no plugin rows never has the hook called and **its panel is
byte-for-byte the panel `buildStylePanel` always built** (`tests/plugin_rows.js` compares the markup
with the pristine tree's through a fake DOM, 6,095 characters; `tests/plugin_rows_browser.py`
compares a live viewer's `#stylePanel` before and after a plugin it has no payload for registers; and
a one-off run (not a test) of a no-plugin viewer's `#stylePanel` built by the pristine tree's bundles and
by these gave identical markup in all three shells: notebook 6,307 chars, web 6,307, embed 6,119).
The group is rebuilt when its SHAPE changes (rows, labels, options) and its controls are updated IN
PLACE when only values change, so a slider being dragged is not rebuilt under the hand. The registry
asks again whenever it collects or harvests geometry, and whenever `setOption` / `setPayload` /
`register` runs: it compares the whole answer with the last one (one JSON compare) before touching
the DOM.

**The legend is one element inside the viewer's own box** (`canvas.parentElement`; the same rule as
the error line), `position:absolute` at the top left, absent when there are no entries and
removed with the plugin's own `legend` option (`false`; the core reads it for every plugin).
**In an exported figure** a PNG or SVG capture draws it into its own context through
`P.drawLegend` (called from `parts/capture.js` after the render): a translucent box, a swatch and a
label per entry. That needed `fillText` on the SVG context, which had none (`core/svg.js`: a few
lines, serialised as a `<text>` element). GIF and ZIP recordings do NOT carry it, and a context with
no `fillText` draws no legend rather than swatches with no words. The DOM legend is not part of the
canvas, so an export has the legend once, the one drawn into it. **An export's legend says what that
export drew, and asking costs the live viewer nothing.** `drawLegend` asks `legend()` again, QUIETLY, for
the painter that drew the export: a local answer, no error state, no badge, no `console.error` on the
live viewer (a `legend()` that throws only for one painter draws no legend into that export and says so
once, as a console warning), and nothing depends on the live legend being non-empty. The painter is
`'svg'` for an SVG export - always the 2D painter, under the 2D cap (a GPU viewer's SVG shows 7,200
edges of a 30,720-edge mesh while its screen says 10,000) - and, for a PNG, `renderer.gpuDrewLastFrame`
read straight after the export's own frame (`parts/capture.js` calls `drawLegend` right after
`_renderToContext`, before the restore repaints the screen). At ordinary dpi a GPU viewer's PNG reuses the
GPU mesh (measured: no plugin call during the export at 96 and 192 dpi) so the screen's note is right,
but when the GPU DECLINES a frame - at about 1,500 dpi (7,475 px) - the 2D painter draws the PNG under
the 2D cap and the note must follow; that is the flag it follows. (The first version said a PNG needed no
such care. It does, in that case.) XML 1.0 forbids C0 control characters, U+FFFE/FFFF and unpaired
surrogates, so the SVG context strips them from every text it writes - the legend's `<text>` elements and
the comments (a plugin's "not drawn" note carries a mesh id) - and `comment()` flattens `--` as before;
`tests/plugin_rows.js` parses the result with a real XML parser.

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
- **The minified bundles are rebuilt and checked, on one toolchain.** The five tracked `.min.js`
  and `dev.html` ship rebuilt with `python3 tools/bundle.py build`; `bundle.py check` and
  `tests/bundles.js` pass on them, and `tests/plugin_browser.py` runs on the tracked notebook bundle
  (it still falls back to an unminified stand-in, and says so, when the tracked one predates the
  registry). The toolchain that reproduces them is terser 5.51.2 run through `bun x` behind an
  `npx` shim (the box has no node or npm of its own: Playwright's driver node v24 plus the shim);
  the same toolchain rebuilds the pristine tree BYTE-IDENTICAL to the bundles committed on main,
  so a delta against them is only this work. A different terser may minify differently, so a
  maintainer's own `build` can differ from these bytes without anything being wrong.
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
- **The `volume` plugin on a real GPU.** Measured in SwiftShader only: the budget (section 12) is
  the spike's measured readable range and the cap's 0.9, not a measured frame time. The mesh
  rebuild a visibility toggle costs on the GPU was counted (`__faceBuilds`), not timed.
- **GIF and ZIP recordings carry no legend** (section 4); a recording with a plugin legend on screen
  shows it only in the DOM, not in the file.
- **The `volume` wireframe over several objects or an alignment, and trajectories** (a frame-bound
  payload is node-tested for its key, not driven through playback in a browser).
- **A notebook with the library borrowed over a BroadcastChannel** (Colab). The
  plugin script is written so it does not care whether it runs before the
  library; the three orders are tested in a page, not through a real borrow.

## 8. Tests, and what each is for

| file | lane | claim |
|---|---|---|
| `tests/plugin_seam.js` | node | R4 (empty registry, unattached plugin, empty plugin all draw byte-identically), R1 (colour reaches the canvas, where it was projected, depth sort), the prim schema, R6 messages, R2 (before the bundle, after, after a viewer is up, twice, a refused one does not stop the bundle loading), R7 (exactly the cap passes; one over draws nothing, names the plugin and cap, logs once per viewer, clears), a throwing plugin rolls back, the key moves with options/payload/frame/own key, `bounds` grows the fitted span at every rotation and zoom and leaves a span orient/focus set alone, `noInk`, `_modelToView` == `_rotateAt` bit for bit and applies `alignTransform` exactly as `_resolvedFrame` does, a refusal is the same parked or direct, the library evaluated twice (`init` once per viewer, late register redraws all), `near` clamped for faces and balls, the per-axis floor (an elongated, a square and a near-square span; the isotropic control reaches 852 A), an older registry cannot replace a newer one, non-finite and absurd coordinates never reach a painter, one cap per painter with the SVG comment and an unmoved key, the tube notice, `linesKeyOf` |
| `tests/plugin_state.py` | node | round trip, unknown names kept and warned about once, no-plugin page and state file byte-identical to the pristine tree's (`--golden`), the page script, escaping, per-page inlining, validation of every `add_plugin` argument (`object`, `frame`, `api_version`, `version`) with no half-made entry left behind |
| `tests/plugin_browser.py` | gpu | a wireframe in both painters and in PNG (and SVG) capture; survives a rotation with no GPU rebuild; disappears and returns with the key, through a rebuild; a cube larger than the structure is not clipped; a plugin ball does not cost the structure its cheap recolour; three registration orders; the `ink` toggle on the GPU (the rim appears and goes); the fit is TIGHT on both axes (between the shell radius and 1.2x the larger of the structure and the shell) on the default helix and on 1CRN, every wireframe check asks for at least 1,000 red px at 600 px, nothing is cropped at the canvas edge, and a focus is tight; 10,008 strokes on the GPU with an SVG export that carries the comment and does not rebuild |
| `tests/plugin_rows.js` | node | R5 against a fake DOM (`tests/fakedom.js`): `rows()` / `legend()` schema (every malformed shape in the test's table is refused, for rows and for the legend), a plugin without either adds NOTHING (no hook call, no element), a malformed or throwing `rows()` / `legend()` is an error state and not a throw, the rows reach the panel as `[{name, title, rows}]` (and a panel mounted late gets them), the legend is one element in the viewer's box and goes with its option or its entries, a label is text, `drawLegend`, and `parts/panel.js`: the plugin-free panel is byte-identical (with `PANEL_BASE=<tree>` to the pristine tree's), a toggle / select / range calls `setOption` with the right arguments, values update in place, a new shape rebuilds, no groups removes the group |
| `tests/plugin_rows_browser.py` | gpu | the same in a real browser, in the notebook (2D and GPU), the web app and the embed, and in the notebook with the plugin registered late: the panel is byte-identical for a viewer with no payload, ONE labelled group with a toggle per cube and a slider, laid out and visible, ONE legend inside the box with a swatch per entry, a checkbox hides a cube (and, on the GPU, rebuilds) and brings it back, the slider thickens the line, the legend option removes the legend, a PNG capture carries the legend and an SVG capture its text |
| `tests/volume_plugin.js` | node | the shipped `volume.js` through the real registry: every malformed payload and bad option in the test's tables is an error state naming the problem, unique edges (cube 18, icosphere 120), `allocate` / `pick` and the exact budget on both painters (7,200 / 10,000 / 54,000), the same lines frame after frame, shown against available in the legend, solid, visibility by mesh and by group, `key()` alone, `bounds()` and the reach cap, `rows()` and `legend()` |
| `tests/volume_state.py` | node | `validate_meshes` (every refusal in the test's table), `add_volume` (refusals store nothing, duplicate ids across calls, appends), the page carries the plugin once and only for a viewer that has a volume payload, the state round trip with no `register_plugin` and no warning, `palette`, `meshes_from_grid` on a synthetic Gaussian well (radius within a voxel, origin and anisotropic spacing, the sign convention and its control, NaN and infinity masked with no wall, levels with no surface skipped, a zero-face mesh never returned) and the lazy scikit-image import (and its message) |
| `tests/volume_browser.py` | gpu | the volume plugin on a synthetic 60-residue helix and on 1CRN, both painters: two Gaussian wells cut by `meshes_from_grid`, the shells drawn (pixel floors), centred on their wells, the fit includes them and is not over-zoomed, the legend (four swatches, two groups), the panel group, a row hides a probe, rotation without a rebuild, PNG and SVG capture, solid is opaque (a nested pair), save_state / load_state draws the same capture, a 30,720-edge mesh is subsampled and the note and the Edges slider say how much |

**Every guard has a mutation that fails it**, run under the commit-free protocol
(back the file up, mutate, run, restore from the backup, `diff` to prove it). The numbers in
parentheses are how many lines failed when the mutation was run, a record and not a contract (tests
grow); the test tables above deliberately give no counts, and `python3 tests/<test> | grep -c ^PASS`
is the live one:

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
| R5: the panel hook not called / `validateRows` returns null / `validateLegend` returns null | `plugin_rows.js` (5 / 18 / 6) |
| R5: the legend element kept with no entries / the `legend` option ignored | `plugin_rows.js` (4 / 3) |
| R5: `syncPluginRows` always rebuilds / makes an empty group for no groups | `plugin_rows.js` (1 / 2) |
| R5: the panel handler writes the label instead of the option | `plugin_rows.js` (3); `plugin_rows_browser.py` (20: a click changes nothing) |
| R5: `checked: false` handed on as the attribute (a checked box) | `plugin_rows.js` (1) |
| R5: the seam does not call `refreshUI` | `volume_plugin.js` (2) |
| R5: `parts/ui.js` does not wire `_syncPluginPanel` | `plugin_rows_browser.py` (no group in the panel) |
| R5: the PNG sink does not draw the legend / the SVG context records no text | `plugin_rows_browser.py` (0 px differ / no legend text in the SVG) |
| volume: unique edges not deduplicated | `volume_plugin.js` (12: a cube draws 36) |
| volume: the stride takes the first k edges / the budget is 1.0 and not 0.9 / water-filling replaced by an equal share | `volume_plugin.js` (2 / 7 / 4) |
| volume: `key()` without the visibility bits | `volume_plugin.js` (3) |
| volume: `legend()` empty / the note removed / group key renamed / group visibility ignored | `volume_plugin.js` (1 / 3 / 2 / 2) |
| volume: `bounds()` null / the payload not cached | `volume_plugin.js` (3 / 1); `volume_browser.py` for `bounds()` (the fit is the structure's alone: not over-zoomed fails) |
| volume: the winding flipped / NaN mask off / scikit-image imported at the top | `volume_state.py` (3 / 3 / 1) |
| volume: the duplicate-id check off / the builtin plugin file unregistered / face range check off / zero-face guard off | `volume_state.py` (7 / 1 / 2 / 1) |
| volume: the registry's key out of `sharedGeometryKey` (the core's own mutation, now against the volume page) | `volume_browser.py` (5: clicking ACE leaves the shells on the GPU) |
| volume: the visibility bits out of `key()` AND the options JSON out of the registry's key | **survives in the browser** - the registry's revision counter moves on every `setOption` (section 12, "Key"); only `volume_plugin.js` can see a wrong plugin key |

## 9. Follow-ups (not built)

| | needs |
|---|---|
| `volume`: translucency, per-vertex colour, a global opacity | the blend pass below; none is in v1 (section 12) |
| `volume`: a ships-minified build | `py2Dmol/resources/plugins/volume.js` is shipped as written (18,493 bytes; 8,158 minified, 3,536 gzipped) and inlined per viewer - a `bundle.py` target would build it |
| `volume`: a bounding sphere for `bounds()` | the registry takes a box; a shell around a protein overshoots by up to the box's corner distance (measured 1.2x on both test structures, section 12) |
| the legend in GIF / ZIP recordings | `P.drawLegend` into each frame's context; the still-image sinks have it |
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

Specified so the API was judged against a real user; implemented after the core - **built,
and section 12 is the as-built version** (where a bullet below differs, section 12 is right).

- **Payload is a mesh, not a grid.** The host extracts isosurfaces (marching
  cubes, in Python, at the requested levels) and sends vertices, faces and a
  colour per level. JS stays a thin renderer; no marching cubes or DX parsing in
  the browser.
- Per level: one shell. Default rendering is **wireframe** (`ctx.line` from the
  mesh edges) because it needs no blending and does not hide the protein;
  optional solid `ctx.tri`, opaque.
- Style rows: per probe/level visibility, wire vs solid; legend entries with the
  probe colour and the level in kcal/mol.
- Budget: *as specified*, the host decimates to `maxPrims`. *As built* the PLUGIN reduces to
  the budget itself (subsampling a fixed stride of edges) and reports shown against available;
  the core still refuses to exceed the cap, but a perfectly ordinary payload never trips it.

## 11. Not proposed

Picking/selection of plugin geometry, live-updating payloads (beyond section 9),
a plugin marketplace, alpha blending, and any change to how residues are drawn.

## 12. The `volume` plugin, as built

**Files.** `py2Dmol/resources/plugins/volume.js` is the plugin. It is **shipped as written, in no
bundle**: `viewer.py` reads it by path (`_BUILTIN_PLUGIN_FILES`; `setup.py` ships
`resources/plugins/*.js`; `tests/packaging.py` checks the read against the list) and inlines it, once, for each viewer that has a
volume payload - so a viewer that never calls `add_volume` pays nothing. It is **18,493 bytes**
(8,158 minified, 3,536 minified and gzipped) and is inlined unminified, once per viewer, which is
the reason a build step for it is a follow-up (section 9). `py2Dmol/volume.py` is the Python half,
`view.add_volume` the entry. `load_state` knows the plugin ships with py2Dmol, so a state file
carrying a volume payload loads with no warning and no `register_plugin` call, and its page draws.

**Payload** - MESHES; no grid and no DX parsing in the browser:

```json
{"meshes": [{"id": "ACE:-1.0", "label": "ACE -1.0", "group": "ACE", "level": -1.0,
             "color": "#ff00ff",
             "vertices": [[x, y, z], ...],      // Angstrom, in the coordinates of the structure
             "faces": [[i, j, k], ...]}],
 "options": {"style": "wire"}}                  // optional defaults for this payload
```

Checked twice (ids are limited to 287 UTF-16 code units and groups to 286, so that the visibility option keys
`visible.mesh.<id>` / `visible.group.<group>` fit the panel's 300. JavaScript's `.length` counts UTF-16
units and Python's `len` counts code points, so Python measures `len(s.encode('utf-16-le')) // 2`: an emoji
is two units, and `tests/volume_state.py` and `tests/volume_plugin.js` run one table of boundary strings
(BMP and astral, 286/287/288) through both sides; `meshes_from_grid` checks the label, the group and the
composite `group:label` id up front, naming the field; an id such as `constructor` or
`__proto__` is an ordinary id). **Python** (`validate_meshes`, before anything is stored, and nothing is
stored on a refusal): meshes a non-empty list of at most 500, ids unique (across `add_volume`
calls too), `label` and `group` short strings (`group` or None), `level` a finite number or None,
`color` `#rrggbb`, `vertices` a finite (N, 3) array with 1 to 1,000,000 rows, `faces` an INTEGER
(M, 3) array of 1 to 2,000,000 rows, every index in range, at most 4,000,000 faces in all, no
unknown key (a `colour` typo is refused). Coordinates are rounded to 1e-4 A. **JavaScript** (the
same rules, on the payload as it arrives): a malformed payload is an ERROR STATE in the plugin's
own `load` slot - the badge, the console, `P.errors(r)`, a message naming the mesh and the problem
- and NOTHING of the plugin is drawn; it never throws into the frame loop. Every callback
(`setPayload`, `key`, `bounds`, `prims`, `rows`, `legend`) refuses the same payload with the same
message, so no callback can clear another's error. A payload is prepared once, cached by the
payload object, so the O(vertices) work (typed arrays, unique edges, a content hash) is never
per frame.

**Options** (plugin level, over the payload's `options`, over the defaults; set from Python with
`add_volume(...)` / `set_plugin_option`, from the panel, or from JS with `setOption`):

| option | default | meaning |
|---|---|---|
| `style` | `"wire"` | `"wire"` or `"solid"` |
| `maxEdgesPerMesh` | 10,000 | the per-mesh cap (triangles in `solid`); 500 to 10,000 on the panel's slider |
| `lineWidth` | 0.1 A | wire width in Angstrom (about one pixel at 600 px) |
| `legend` | true | the legend element (and its place in a capture) |
| `visible.mesh.<id>` | shown | `false` hides that mesh |
| `visible.group.<group>` | shown | `false` hides every mesh of the group |

**Rendering.** Wire (the default): the UNIQUE undirected edges of the triangles - each edge once,
deduplicated, in order of first appearance over the faces - emitted with `ctx.line` in the mesh
colour (`noInk`, no dark rim: the plugin default). A cube of 12 triangles is 18 edges (12 and a
diagonal on each face), an icosphere of 80 faces is 120 (`tests/volume_plugin.js`). Solid:
`ctx.tri`, opaque and flat-lit by each triangle's own normal, double-sided; **no translucency in
v1, and no global opacity** (the dither measured ugly, D4), no per-vertex colour.

**The budget** (a decision with a measured basis, not a measurement of a limit). The spikes
measured the readable range of a wireframe at 600 px: 2,000-10,000 lines per shell, 30,720 a
near-solid disc, 23,040 over three nested shells moire. So the plugin first caps each mesh at
`maxEdgesPerMesh` (10,000), then, if the visible meshes together are still over
`floor(0.9 * ctx.maxPrims)` - **7,200 on the 2D painter, 54,000 on the GPU** - it shares that budget by
WATER-FILLING (meshes in order of size, ties by index; each takes the lesser of all it has and an equal
share of what is left among those still to come - so a small mesh keeps all it has, the larger ones
split the rest, the integer remainder falls to the largest; the sum is exactly the budget when the
meshes were over it). It draws every n-th edge of a mesh, `floor(j * n / k)` for j < k, a FIXED
stride over a fixed ordering: same input, same lines, frame after frame, nothing shimmers between
frames and the GPU mesh is the same on every rebuild. That is **subsampling, not geometric
decimation**: the surface keeps its shape and loses density, and a mesh with holes in its wire is
still a recognisable surface; a solid mesh with triangles missing is not, so in `solid` keep meshes
under the budget. What was drawn against what exists is REPORTED, per mesh and per painter, in
the legend's note ("shown 7,200 of 30,720 edges"; triangles in `solid`) and once on the console;
the core's cap error is not tripped by an ordinary payload (a 30,720-edge icosphere on both
painters: no error state, `tests/volume_browser.py`). The 0.9 leaves headroom, and the core's throw,
for a plugin that overruns by mistake.

**The fit.** `bounds(ctx)` is the extent of EVERY mesh (hidden ones too, so the fit does not move
when a shell is toggled), handed to the registry as a box and held to the core's reach rule - a
mesh 1,000,000 A away is ignored and reported, not allowed to stretch the depth range
(`tests/volume_plugin.js`). The floor applies to the fit and not to a span orient or focus set
(section 4). Measured on a 600 px canvas with the shells of two Gaussian wells: the helix (88 A long)
fits at half-span 38.3 x 44.3 A with the farthest shell point 32.7 A from the centre; 1CRN at
20.2 x 20.2 A with the farthest shell point 16.5 A away - nothing cropped at the canvas edge, and
within 1.35x of what the structure and shells need. The registry turns the box into a radius about
the view centre, so a shell around a protein overshoots by up to the box's corner distance (1.22x on
1CRN); a bounding sphere would be tighter and is a follow-up.

**Key.** `key(ctx)` folds the payloads' content hashes (ids, counts and every coordinate, hashed
ONCE when the payload is prepared, not per frame), the style, `maxEdgesPerMesh`, `lineWidth` and one
bit per mesh for visibility. It moves exactly when the drawing moves: the legend option and an option
the plugin does not read leave it alone. **The registry's own key moves on every `setOption`** (a
revision counter, and the options JSON), so a plugin that left something out of its key would still
redraw on the GPU after a `setOption` - measured: with the visibility bits out of this key AND the
options JSON out of the registry's, `tests/volume_browser.py` still passes. A browser probe therefore
cannot catch a wrong plugin `key()`; it is tested ALONE in node (section 8).

**UI** (through R5). In the Style panel, under the heading "Volume": one checkbox row PER GROUP (a
mesh with no group is its own row), a Style select (wire / solid), an Edges slider
(`maxEdgesPerMesh`) and a Legend toggle. At most 90 mesh rows. Clicking a group hides its meshes
and their legend entries; on the GPU that is a mesh rebuild (the key moved), counted not timed. The
legend lists the visible meshes under their group, a swatch and the label each, with the budget note.

**Python.**

```python
meshes = py2Dmol.volume.meshes_from_grid(grid, origin, spacing, levels,
             labels=None, colors=None, group=None, mask_nan=True, inside="below")
view.add_volume(meshes, name="volume", object=None, frame=None, style="wire",
                max_edges_per_mesh=None, legend=None)      # chainable
```

`add_volume` validates, then stores through `add_plugin` (viewer-level state, `save_state` /
`load_state`, sent with `show()`). `name` must be `"volume"` (one volume plugin per viewer: call it
again to add meshes). A second call APPENDS a payload; `style` is viewer-wide and the last call's
value wins, as does `max_edges_per_mesh` / `legend` when given. `py2Dmol.volume.palette(n,
"sequential" | "diverging")` gives n `#rrggbb` colours (light to dark blue; blue-white-red).

**`meshes_from_grid` conventions.** `grid[i, j, k]` is the value at `origin + (i, j, k) * spacing`,
Angstrom (spacing one number or one per axis); `levels` are isovalues, a mesh is the surface
`grid == level`. **For dG shells pass NEGATIVE levels: each surface encloses the voxels BELOW
the level** (a well); `inside="below"` (the default) sets only the triangles' winding so normals point
out of the well - scikit-image's `gradient_direction='descent'`, which was measured to give a positive
signed volume (the names read the other way round; `"above"` is for a density) and is checked on a
synthetic Gaussian well, together with its mirror image, in `tests/volume_state.py`. **NaN (and
infinite) voxels are cut out**: marching cubes cannot read them, so each is filled with a value on
the exterior side of the level and the grid is meshed, and then EVERY FACE IN A CELL THAT HAS A
NON-FINITE CORNER is dropped, with the vertices nothing uses any more. What is left is the part of the
surface made wholly from real voxels, on whichever side of an axis the missing data lies, and it is
left OPEN at the edge of the data, not closed with a wall. scikit-image's own `mask=` is deliberately
NOT used: it skips a cube by ONE corner, so with the missing data on the LOW side of an axis the cubes
touching it were still meshed against the fill and a wall stayed (a review reproduced 230 / 168 / 126
vertices off a sphere of R = 3 for NaN below the centre in x / y / z; the first tests only cut the high
side). The fill is load-bearing - marching cubes needs a number - and so is the drop; every case is
tested against the NaN-free mesh (survivors = exactly its faces whose cell is finite).
With `mask_nan=False` a grid containing NaN raises. A level whose surface has no
faces (outside the data, or entirely in the missing data) is SKIPPED with a warning - never an empty mesh;
a grid with no finite voxel returns `[]` with a warning. The
function needs scikit-image (`pip install scikit-image`), imported only when it is called; without it
the `ImportError` names the package and the command.

**A known cost.** `meshes_from_grid` runs scikit-image's marching cubes on the whole grid and, with NaN present,
drops faces afterwards: on a pathological 128^3 grid of pure noise (millions of faces) a review measured
18.6 s and 2.1 GB. Real shells are nothing like it (measured here: a 100^3 Gaussian well, two levels, 0.03 s, with or without NaN), but a noisy
field cut at a level that crosses most cells is slow and large - threshold or smooth it first. And when two
levels would share a `%g` label, ALL default labels of that call get 12 significant digits (the ids change
together, so they stay consistent within the call).

**Not supported in v1:** translucency, a global opacity, per-vertex colour (a colour per mesh), a
live update to a viewer already on the page (a second `add_volume` after `show()` appears when the
page is shown again - the core's rule), picking, the tube style (it draws no plugin), `name` other than
`"volume"`. **Not measured:** the GPU cost on a real GPU.
