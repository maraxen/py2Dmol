# The `volume` plugin

`volume` draws isosurface shells around a structure, as a wireframe (the default) or as opaque
triangles. It is the first plugin that ships with py2Dmol, and it is written against the public plugin
API in `docs/PLUGINS.md` and nothing else. Python builds the meshes; the browser only draws them.

```python
meshes = py2Dmol.volume.meshes_from_grid(grid, origin, spacing, levels,
             labels=None, colors=None, group=None, mask_nan=True, inside="below")
view.add_volume(meshes, name="volume", object=None, frame=None, style="wire",
                max_edges_per_mesh=None, legend=None)      # chainable
```

## Files

`py2Dmol/resources/plugins/volume.js` is the plugin. It is **shipped as written, in no bundle**:
`viewer.py` reads it by path (`_BUILTIN_PLUGIN_FILES`) and inlines it, once, for each viewer that has a
volume payload, so a viewer that never calls `add_volume` pays nothing and the five bundles are
unchanged by it. `setup.py` ships `resources/plugins/*.js` and `tests/packaging.py` checks every file
`viewer.py` opens against that list. The file is 18,493 bytes, 8,157 minified (`terser -c -m`, the
bundles' flags) and 3,533 minified and gzipped (`gzip -9 -n`); it is inlined unminified, and that cost
is paid once per viewer that uses it. `py2Dmol/volume.py` is the Python half. `load_state` knows the
plugin ships with py2Dmol, so a state file with a volume payload loads with no warning and no
`register_plugin` call.

## Payload

Meshes, not a grid: no marching cubes and no file parsing in the browser.

```json
{"meshes": [{"id": "A:-1.0", "label": "A -1.0", "group": "A", "level": -1.0,
             "color": "#ff00ff",
             "vertices": [[x, y, z], ...],      // Angstrom, in the coordinates of the structure
             "faces": [[i, j, k], ...]}],
 "options": {"style": "wire"}}                  // optional defaults for this payload
```

It is checked twice with the same rules. **Python** (`validate_meshes`, before anything is stored; a
refusal stores nothing): a non-empty list of at most 500 meshes; ids unique, also across `add_volume`
calls; `label` and `group` short strings (`group` may be None); `level` a finite number or None; `color`
`#rrggbb`; `vertices` a finite (N, 3) array of 1 to 1,000,000 rows; `faces` an integer (M, 3) array of 1
to 2,000,000 rows with every index in range; at most 4,000,000 faces in all; no unknown key (a `colour`
typo is refused). Coordinates are rounded to 1e-4 A. Ids are limited to 287 UTF-16 code units and
groups to 286, so that the visibility option keys `visible.mesh.<id>` and `visible.group.<group>` fit
the panel's 300. JavaScript's `.length` counts UTF-16 units and Python's `len` counts code points, so
Python measures `len(s.encode('utf-16-le')) // 2`: an emoji is two units. **JavaScript** (the payload as
it arrives): a malformed payload is an error state in the plugin's `load` slot (the badge, the console,
`P.errors(r)`, a message naming the mesh and the problem) and nothing of the plugin is drawn. Every
callback refuses the same payload with the same message. A payload is prepared once, cached by the
payload object, so the O(vertices) work (typed arrays, unique edges, a content hash) is never per frame.

## Options

Plugin level, over the payload's `options`, over the defaults. Set from Python with `add_volume(...)` or
`set_plugin_option`, from the Style panel, or from JavaScript with `setOption`.

| option | default | meaning |
|---|---|---|
| `style` | `"wire"` | `"wire"` or `"solid"`; viewer-wide, the last `add_volume` call's value wins |
| `maxEdgesPerMesh` | 10,000 | the per-mesh cap (triangles in `solid`); 500 to 10,000 on the panel's slider |
| `lineWidth` | 0.1 A | wire width in Angstrom |
| `legend` | true | the legend element, and its place in a PNG or SVG export |
| `visible.mesh.<id>` | shown | `false` hides that mesh |
| `visible.group.<group>` | shown | `false` hides every mesh of the group |

## Rendering

Wire draws the unique undirected edges of the triangles, each edge once, in order of first appearance
over the faces, with `ctx.line` in the mesh colour and no dark rim (the plugin default). A cube of 12
triangles has 18 edges and an 80-face icosphere 120 (`tests/volume_plugin.js`). Solid draws `ctx.tri`:
opaque, flat-lit by each triangle's own normal, double-sided. There is no translucency, no global
opacity and no per-vertex colour.

## The budget: a decision with a measured basis, not a limit

While choosing the numbers, a wireframe at 600 px was judged by eye, not by a script that was kept:
2,000 to 10,000 lines per shell read well, 30,720 lines on a near-solid disc did not, and 23,040 over
three nested shells gave moire. So the plugin first caps each mesh at `maxEdgesPerMesh`, then, if the
visible meshes together are still over `floor(0.9 * ctx.maxPrims)` (**7,200 on the 2D painter, 54,000
on the GPU**), shares that budget by water-filling: meshes in order of size, ties by index, each taking
the lesser of everything it has and an equal share of what is left among those still to come. Small
meshes keep all they have, larger ones split the rest, the integer remainder goes to the largest, and
the sum is exactly the budget when the meshes were over it.

From each mesh it draws every n-th edge, `floor(j * n / k)` for j < k: a **fixed stride over a fixed
order**, so the same input draws the same lines on every frame, nothing shimmers and the GPU mesh is the
same on every rebuild. "The first k" would be deterministic too and would draw one end of the surface.
This is subsampling, not decimation: a wireframe with gaps is still a recognisable surface; a solid mesh
with triangles missing is not, so keep solid meshes under the budget. What was drawn against what exists
is reported per mesh and per painter in the legend's note ("shown 7,200 of 30,720 edges"; triangles in
solid) and once on the console. The 0.9 leaves headroom, and the core's `PluginBudgetError`, for a
plugin that overruns by mistake: an ordinary payload never trips it (`tests/volume_browser.py` draws a
30,720-edge icosphere on both painters with no error state). A GPU viewer's SVG export is drawn by the
2D painter, so its legend says what the 2D painter drew, not the screen's note.

## The fit, and `key()`

`bounds(ctx)` is the extent of every mesh, shown or not, so the fit does not move when a shell is
toggled. It is held to the core's reach rule: a mesh a million Angstrom away is ignored and reported
instead of stretching the depth range. The registry turns the box into a radius about the view centre
(section 6 of `PLUGINS.md`), so a shell around a protein overshoots by up to the corner distance of its
box. Measured by `tests/volume_browser.py` on a 600 px canvas with the shells of two Gaussian wells: the
88 A helix fits at a half-span of 38.3 x 44.3 A with the farthest shell point 32.7 A from the centre,
and 1CRN at 20.2 x 20.2 A with the farthest 16.5 A away (a 1.22x overshoot); nothing is cropped at the
canvas edge and both stay within 1.35x of what the structure and the shells need. A bounding sphere
would be tighter.

`key(ctx)` folds the payloads' content hashes (ids, counts and every coordinate, hashed once when the
payload is prepared), the style, `maxEdgesPerMesh`, `lineWidth` and one bit per mesh for visibility. It
moves exactly when the drawing moves: the `legend` option leaves it alone. The registry's own key moves
on every `setOption`, so a wrong plugin `key()` redraws correctly on the GPU anyway and a browser probe
cannot catch it; `key()` is tested on its own in node (`tests/volume_plugin.js`).

## The Style panel and legend

Under the heading "Volume": one checkbox row per group (a mesh with no group is its own row; at most 90
rows), a Style select (wire or solid), an Edges slider and a Legend toggle. Clicking a group hides its
meshes and their legend entries; on the GPU that is a mesh rebuild. The legend lists the visible meshes
under their group, a swatch and the label each, with the budget note.

## `add_volume` and `meshes_from_grid`

`add_volume` validates, then stores through `add_plugin`: viewer-level state, kept by `save_state` /
`load_state`, sent with `show()`. `name` must be `"volume"` (one volume plugin per viewer: call it again to
add meshes). A second call appends a payload. `py2Dmol.volume.palette(n, "sequential" | "diverging")`
gives n `#rrggbb` colours.

`meshes_from_grid` needs scikit-image (`pip install scikit-image`), imported only when it is called; the
`ImportError` names the package and the command.

- **Units.** `grid[i, j, k]` is the value at `origin + (i, j, k) * spacing`, in Angstrom; `spacing` is
  one number or one per axis. A mesh is the surface `grid == level`.
- **Sign.** For free-energy shells pass **negative levels**: each surface encloses the voxels below the
  level, a well. `inside="below"` (the default) sets only the triangles' winding so that normals point out
  of the well: scikit-image's `gradient_direction='descent'`, which gives a positive signed volume (the
  names read the other way round). `"above"` is for a density. Both are checked on a synthetic Gaussian
  well and its mirror image in `tests/volume_state.py`.
- **NaN and infinite voxels are cut out, and cost the meshing nothing extra.** Marching cubes is told to
  skip every cube that has a non-finite corner, so nothing is generated for them and nothing is dropped
  afterwards. What is left is the part of the surface made wholly from real voxels, left open at the edge
  of the data, not closed with a wall; a face lying exactly in a lattice plane that a skipped cube shares is
  kept, because the cube it belongs to is all finite. The missing voxels are replaced by a finite
  placeholder first, only because marching cubes checks the level against the data's range and cannot read
  NaN; no skipped cube uses it. The mask is scikit-image's `mask=`, which is looked up at a cube's **far**
  corner: mask False at voxel (x+1, y+1, z+1) skips the cube whose origin is (x, y, z). The mask that skips
  exactly the bad cubes is therefore the cell mask (a cube with any non-finite corner) shifted by one, and
  not `~finite`, which skips the wrong cubes: with scikit-image 0.26.0, a sphere of radius 3 and NaN below
  its centre, 221, 173 and 133 vertices (x, y, z) lay off the sphere, and none for NaN above it (a
  throwaway probe, not in the suite). Because that indexing is an implementation detail,
  `_far_corner_mask_ok()` checks it once per process on a 5^3 field (under a millisecond) and, where it does
  not hold, `meshes_from_grid` meshes the bad cubes and drops their faces afterwards
  (`_drop_faces_in_bad_cells`), which is slower and larger and drops lattice-plane faces next to a bad
  cube as well. `tests/volume_state.py` holds the mask path to a brute force (every cube with eight finite
  corners meshed alone) for NaN on both sides of each axis, a slab, an octant, a lone finite island,
  scattered 2% NaN, both `inside` values and an integer field cut on the nodes, and the fallback to
  vertex positions. A grid with no NaN is meshed without `mask=`, exactly as before. With `mask_nan=False` a
  grid containing NaN raises.
- **Skipped levels.** A level whose surface has no faces is skipped with a warning, never returned as an
  empty mesh; a grid with no finite voxel returns `[]` with a warning.
- **Labels and ids.** Default labels are `"%g"` of the level; if two levels would share one, all default
  labels of that call get 12 significant digits (`"%.12g"`), so the ids stay consistent within the call.
  The id is `"<group>:<label>"` or the label; a clash raises `ValueError`, naming the field.

## Cost

**In the page.** No bundle grows. A viewer that uses the plugin carries `volume.js` once, 18,493 bytes
unminified (see Files), plus its payload.

**In Python.** `meshes_from_grid` is scikit-image's marching cubes on the whole grid, with the cubes that
touch missing data skipped. Measured once on this tree (throwaway probe, one process per variant, peak
RSS including about 65 to 90 MB of interpreter and imports, scikit-image 0.26.0):

| grid | meshes, faces | seconds | peak MB |
|---|---|---|---|
| 128^3 noise cut at 0, no NaN | 1, 7,195,753 | 2.47 | 431 |
| the same with 1% of the voxels NaN | 1, 6,639,438 | 2.63 | 433 |
| the same with 1% NaN, the previous version of the function (meshed everything, dropped faces after) | 1, 6,639,372 | 17.70 | 2,268 |
| 100^3 Gaussian well, two levels | 2, 20,968 | 0.04 | 87 |
| the same with 1% NaN | 2, 19,579 | 0.05 | 95 |

The 66 faces by which the new result exceeds the previous one on the noise grid are of the kind found on a
40^3 noise grid, where the 2 extra faces lie exactly in the lattice plane y = 34 that a skipped cube shares:
they belong to a cube with eight finite corners, so they are kept.
A noise field crosses most cells and gives millions of faces; `add_volume` refuses a mesh over 2,000,000
faces anyway, so threshold or smooth a noisy field first.

## Not supported, and not measured

Not supported: translucency, a global opacity, per-vertex colour (one colour per mesh), a live update to a
viewer already on the page (a second `add_volume` after `show()` appears when the page is shown again),
picking, the tube style (it draws no plugin), and any `name` other than `"volume"`.

Not measured: the cost on a real GPU (everything ran through SwiftShader); a Mac; a payload bound to a
frame, played back as a trajectory (its key is node-tested, not driven through playback in a browser);
meshes over several objects or an alignment in a browser.
