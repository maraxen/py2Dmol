"""Isosurface shells for the `volume` plugin (docs/PLUGIN_VOLUME.md).

    meshes = py2Dmol.volume.meshes_from_grid(grid, origin, spacing, levels)
    view.add_volume(meshes)

The plugin draws MESHES, so this is the Python half: ``validate_meshes`` (what
``view.add_volume`` runs before anything is stored) and ``meshes_from_grid``
(marching cubes over a 3-D field, with scikit-image, imported only when called).

A mesh is a dict::

    {"id": str,              # unique across the viewer; what a visibility option names
     "label": str,           # legend / panel text; default: the id
     "group": str | None,    # meshes of one group share a panel row and a legend heading
     "level": float | None,  # the isovalue it was cut at, for the reader
     "color": "#rrggbb",
     "vertices": (N, 3),     # Angstrom, in the coordinates of the structure
     "faces": (M, 3)}        # integer indices into vertices
"""
import math
import numbers
import re
import warnings

import numpy as np

VERSION = "1.0"
STYLES = ("wire", "solid")

# The same limits the JavaScript refuses at (resources/plugins/volume.js), so a payload
# that gets past Python is not turned away in the page.
MAX_MESHES = 500
MAX_VERTICES = 1_000_000
MAX_FACES = 2_000_000
MAX_TOTAL_FACES = 4_000_000
MAX_TEXT = 300

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_KEYS = {"id", "label", "group", "level", "color", "vertices", "faces"}


# A mesh's visibility is a plugin OPTION named "visible.mesh.<id>" (or "visible.group.<group>"),
# and the panel refuses an option key over MAX_TEXT characters - which would take the whole
# plugin UI down. So the id and the group are limited by what is left after the prefix.
ID_LIMIT = MAX_TEXT - len("visible.mesh.")
GROUP_LIMIT = MAX_TEXT - len("visible.group.")


def _u16(text):
    """Length in UTF-16 code units - what JavaScript's ``.length`` counts, and what the plugin's limits
    are written in. ``len`` counts code points, so an emoji (two units) would pass here and be refused
    in the browser."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def _text(value, what, allow_none=False, limit=MAX_TEXT, why=""):
    if value is None and allow_none:
        return None
    if not isinstance(value, str) or not value or _u16(value) > limit:
        raise ValueError("%s must be a non-empty string of at most %d UTF-16 code units%s, not %r"
                         % (what, limit, why, value if not isinstance(value, str) else value[:40]))
    return value


def validate_meshes(meshes):
    """Check a list of mesh dicts and return it as plain JSON-ready data.

    Raises ``TypeError`` / ``ValueError`` naming the mesh and the problem. Coordinates are
    rounded to 1e-4 Angstrom (the payload is the size of the page, and that is a hundredth
    of a bond-length's last digit).
    """
    if isinstance(meshes, dict) or isinstance(meshes, (str, bytes)) or not hasattr(meshes, "__iter__"):
        raise TypeError("meshes must be a list of mesh dicts, not %s" % type(meshes).__name__)
    meshes = list(meshes)
    if not meshes:
        raise ValueError("meshes is empty - nothing to draw")
    if len(meshes) > MAX_MESHES:
        raise ValueError("%d meshes; the limit is %d" % (len(meshes), MAX_MESHES))
    out, ids, total_faces = [], set(), 0
    for i, m in enumerate(meshes):
        where = "mesh #%d" % i
        if not isinstance(m, dict):
            raise TypeError("%s is %s, not a dict" % (where, type(m).__name__))
        unknown = set(m) - _KEYS
        if unknown:
            raise ValueError("%s has unknown key(s) %s (expected %s)"
                             % (where, sorted(unknown), sorted(_KEYS)))
        for need in ("id", "color", "vertices", "faces"):
            if need not in m:
                raise ValueError("%s has no %r" % (where, need))
        mid = _text(m["id"], where + ": id", limit=ID_LIMIT,
                    why=" (its visibility option key must fit %d)" % MAX_TEXT)
        where = "mesh #%d (%r)" % (i, mid[:40])
        if mid in ids:
            raise ValueError("%s: id appears twice" % where)
        ids.add(mid)
        label = _text(m.get("label", mid) if m.get("label") is not None else mid, where + ": label")
        group = _text(m.get("group"), where + ": group", allow_none=True, limit=GROUP_LIMIT,
                      why=" (its visibility option key must fit %d)" % MAX_TEXT)
        level = m.get("level")
        if level is not None:
            if isinstance(level, bool) or not isinstance(level, numbers.Real) or not math.isfinite(level):
                raise ValueError("%s: level must be a finite number or None, not %r" % (where, level))
            level = float(level)
        color = m["color"]
        if not isinstance(color, str) or not _HEX.match(color):
            raise ValueError("%s: color must be written '#rrggbb', not %r" % (where, color))
        try:
            v = np.asarray(m["vertices"], dtype=float)
        except (TypeError, ValueError) as e:
            raise ValueError("%s: vertices must be a (N, 3) array of numbers (%s)" % (where, e)) from None
        if v.ndim != 2 or v.shape[1] != 3 or v.shape[0] < 1:
            raise ValueError("%s: vertices must have shape (N, 3) with N >= 1, got %s" % (where, v.shape))
        if v.shape[0] > MAX_VERTICES:
            raise ValueError("%s: %d vertices; the limit is %d" % (where, v.shape[0], MAX_VERTICES))
        if not np.isfinite(v).all():
            raise ValueError("%s: vertices contain NaN or infinity" % where)
        f = np.asarray(m["faces"])
        if f.ndim != 2 or f.shape[1] != 3 or f.shape[0] < 1:
            raise ValueError("%s: faces must have shape (M, 3) with M >= 1 (a mesh with no faces"
                             " draws nothing), got %s" % (where, f.shape))
        if f.dtype.kind not in "iu":
            raise TypeError("%s: faces must be integer indices, not dtype %s" % (where, f.dtype))
        if f.shape[0] > MAX_FACES:
            raise ValueError("%s: %d faces; the limit is %d" % (where, f.shape[0], MAX_FACES))
        if f.min() < 0 or f.max() >= v.shape[0]:
            raise ValueError("%s: face indices must lie in 0..%d, found %d..%d"
                             % (where, v.shape[0] - 1, f.min(), f.max()))
        total_faces += f.shape[0]
        if total_faces > MAX_TOTAL_FACES:
            raise ValueError("more than %d faces in all" % MAX_TOTAL_FACES)
        out.append({"id": mid, "label": label, "group": group, "level": level,
                    "color": color.lower(),
                    "vertices": np.round(v, 4).tolist(), "faces": f.astype(int).tolist()})
    return out


def palette(n, kind="sequential"):
    """``n`` colours as ``#rrggbb``: ``"sequential"`` (light to dark blue; for shells of one
    kind ordered by level) or ``"diverging"`` (blue, white, red; for differences)."""
    if kind not in ("sequential", "diverging"):
        raise ValueError("palette kind must be 'sequential' or 'diverging', not %r" % (kind,))
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise ValueError("palette(n): n must be an int >= 1, not %r" % (n,))
    anchors = ([(0xc6, 0xdb, 0xef), (0x08, 0x30, 0x6b)] if kind == "sequential"
               else [(0x21, 0x66, 0xac), (0xf7, 0xf7, 0xf7), (0xb2, 0x18, 0x2b)])
    out = []
    for i in range(n):
        t = 0.5 if n == 1 else i / (n - 1)
        pos = t * (len(anchors) - 1)
        a = min(int(pos), len(anchors) - 2)
        u = pos - a
        rgb = [round(anchors[a][c] + (anchors[a + 1][c] - anchors[a][c]) * u) for c in range(3)]
        out.append("#%02x%02x%02x" % tuple(rgb))
    return out


def _vec3(x, what):
    a = np.asarray(x, dtype=float)
    if a.ndim == 0:
        a = np.full(3, float(a))
    if a.shape != (3,) or not np.isfinite(a).all():
        raise ValueError("%s must be a finite number or three of them, got %r" % (what, x))
    return a


def meshes_from_grid(grid, origin, spacing, levels, *, labels=None, colors=None, group=None,
                     mask_nan=True, inside="below"):
    """Marching cubes over a 3-D field: one mesh per isovalue.

    Args:
        grid: array-like ``(nx, ny, nz)``; ``grid[i, j, k]`` is the value at
            ``origin + (i, j, k) * spacing`` (so axis 0 is x, 1 is y, 2 is z).
        origin: (x, y, z) in Angstrom of voxel ``[0, 0, 0]``.
        spacing: voxel size in Angstrom: one number, or one per axis.
        levels: the isovalues. A mesh is the surface ``grid == level``.
        labels / colors: one per level (default: ``"<level:g>"`` and ``palette(len(levels))``).
        group: a group name given to every mesh (they then share one panel row).
        mask_nan: True (the default) cuts NaN or infinite voxels OUT. Marching cubes is told
            to skip every cube (cell) that has a non-finite corner, so the surface is the part
            made wholly from real voxels, on whichever side of an axis the missing data lies;
            a surface cut off by missing data is left OPEN at the edge of the data, not closed
            with a wall. Nothing is generated for the skipped cubes, so missing data costs the
            meshing nothing extra. (The missing voxels are replaced by a finite placeholder
            first, only because marching cubes checks the level against the data's range and
            cannot read NaN; no skipped cube uses it.) With False a grid that has NaN raises.
        inside: which side of the level is the interior. ``"below"`` (the default) is the
            free-energy convention: for dG you pass NEGATIVE levels and each surface
            encloses the voxels LOWER than the level (the wells); ``"above"`` is a density.
            It sets only the triangles' winding - the surface is the same set of points -
            so that normals point out of the interior (``gradient_direction='descent'`` in
            scikit-image for "below", ``'ascent'`` for "above"; checked on a synthetic well
            in tests/volume_state.py).

    Returns:
        A list of mesh dicts (numpy arrays for ``vertices`` and ``faces``), ready for
        ``view.add_volume``. ``vertices`` are float64 and ``faces`` int32. A level whose surface has no faces (outside the data, or
        entirely in the missing data) is SKIPPED with a warning - never an empty mesh - and
        a grid with no finite voxel returns ``[]`` with a warning. Default labels are
        ``"%g"`` of the level (more digits if two levels would otherwise share one); the id
        is ``"<group>:<label>"`` or the label, and a clash raises ``ValueError``.

    Needs scikit-image (``pip install scikit-image``), imported here and not before.
    """
    try:
        from skimage.measure import marching_cubes
    except ImportError as e:
        raise ImportError("meshes_from_grid needs scikit-image for marching cubes: "
                          "pip install scikit-image") from e
    if inside not in ("below", "above"):
        raise ValueError("inside must be 'below' or 'above', not %r" % (inside,))
    g = np.asarray(grid, dtype=float)
    if g.ndim != 3 or min(g.shape) < 2:
        raise ValueError("grid must be 3-D with at least 2 voxels along each axis, got shape %s" % (g.shape,))
    org = _vec3(origin, "origin")
    sp = _vec3(spacing, "spacing")
    if (sp <= 0).any():
        raise ValueError("spacing must be positive, got %s" % (sp,))
    lv = np.atleast_1d(np.asarray(levels, dtype=float))
    if lv.ndim != 1 or not lv.size or not np.isfinite(lv).all():
        raise ValueError("levels must be one or more finite numbers, got %r" % (levels,))
    n = len(lv)
    if labels is not None and len(labels) != n:
        raise ValueError("%d labels for %d levels" % (len(labels), n))
    if colors is not None and len(colors) != n:
        raise ValueError("%d colors for %d levels" % (len(colors), n))
    if labels is not None:
        labs = [str(x) for x in labels]
    else:
        # "%g" keeps six digits: levels that differ further out would give two meshes the same id
        labs = ["%g" % x for x in lv]
        if len(set(labs)) != n:
            labs = ["%.12g" % x for x in lv]
    cols = list(colors) if colors is not None else palette(n)
    if group is not None:
        _text(group, "group", limit=GROUP_LIMIT, why=" (its visibility option key must fit %d)" % MAX_TEXT)
    ids = ["%s:%s" % (group, lab) if group else lab for lab in labs]
    # every field a mesh will be refused for is checked HERE, naming the field, not later in validate_meshes
    for lab, mid in zip(labs, ids):
        _text(lab, "meshes_from_grid: label", limit=MAX_TEXT)
        _text(mid, "meshes_from_grid: the id %r (group + ':' + label)" % (mid[:30],), limit=ID_LIMIT,
              why=" (its visibility option key must fit %d)" % MAX_TEXT)
    if len(set(ids)) != n:
        dups = sorted({i for i in ids if ids.count(i) > 1})
        raise ValueError("meshes_from_grid: levels %s give the same mesh id %s - the levels (or the labels) "
                         "must be distinct" % (list(map(float, lv)), dups[:3]))

    finite = np.isfinite(g)
    bad_cell = None
    keep = None
    has_missing = not finite.all()
    if not finite.all():
        if not mask_nan:
            raise ValueError("grid has NaN or infinite voxels; marching cubes cannot read them - pass "
                             "mask_nan=True (faces in cells that touch them are dropped) or fill them yourself")
        if not finite.any():
            warnings.warn("grid has no finite voxel at all: no meshes", stacklevel=2)
            return []
        span = float(g[finite].max() - g[finite].min())
        # THE FILL IS A PLACEHOLDER, NOT DATA: marching cubes cannot read NaN, and it checks the
        # level against min/max of the whole array (NaN fails that), so each missing voxel gets a
        # finite value on the EXTERIOR side of every level. No cube that touches one is meshed
        # (the mask below), so the value is never interpolated into a vertex.
        fill = (float(g[finite].max()) + span + 1.0) if inside == "below" else (float(g[finite].min()) - span - 1.0)
        g = np.where(finite, g, fill)
        bad_cell = np.zeros(tuple(s - 1 for s in g.shape), dtype=bool)
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    bad_cell |= ~finite[dx:g.shape[0] - 1 + dx, dy:g.shape[1] - 1 + dy, dz:g.shape[2] - 1 + dz]
        if _far_corner_mask_ok():
            # scikit-image's mask= is looked up at a cube's FAR corner: mask False at voxel
            # (x+1, y+1, z+1) skips the cube whose origin is (x, y, z). So the mask that skips
            # exactly the bad cubes is the DILATED cell mask, shifted by one - not ~finite, which
            # skips the wrong cubes and left a wall of 221 / 173 / 133 vertices for NaN below the
            # centre of a sphere (docs/PLUGIN_VOLUME.md). _far_corner_mask_ok() checks the
            # convention on the installed scikit-image; where it does not hold, the bad cubes are
            # meshed and their faces dropped afterwards (_drop_faces_in_bad_cells).
            keep = np.ones(g.shape, dtype=bool)
            keep[1:, 1:, 1:] = ~bad_cell
            bad_cell = None

    out = []
    for level, label, mid, color in zip(lv, labs, ids, cols):
        kw = {"spacing": tuple(sp), "gradient_direction": "descent" if inside == "below" else "ascent"}
        if keep is not None:
            kw["mask"] = keep
        try:
            verts, faces, _, _ = marching_cubes(g, float(level), **kw)
        except (ValueError, RuntimeError) as e:
            warnings.warn("level %g skipped: no surface (%s)" % (level, e), stacklevel=2)
            continue
        if bad_cell is not None and len(faces):
            verts, faces = _drop_faces_in_bad_cells(verts, faces, sp, bad_cell)
        if len(faces) == 0:
            warnings.warn("level %g skipped: its surface has no faces%s" % (
                level, " outside the missing data" if has_missing else ""), stacklevel=2)
            continue
        # float32 from scikit-image, float64 out (as it has always been); one allocation, no temporary
        verts = verts.astype(np.float64)
        verts += org
        out.append({"id": mid, "label": str(label), "group": group, "level": float(level),
                    "color": color, "vertices": verts, "faces": faces.astype(np.int32, copy=False)})
    return out


_FAR_CORNER_OK = None


def _far_corner_mask_ok():
    """Does the installed scikit-image look its ``mask=`` up at a cube's FAR corner?

    That is, does mask False at voxel (x+1, y+1, z+1) skip exactly the cube whose origin is (x, y, z)?
    It is how ``meshes_from_grid`` skips the cubes that touch missing data, an implementation detail
    of scikit-image (checked by hand on 0.26.0), so it is checked here on a 5^3 field - once, cached.
    If it does not hold, or the probe cannot run, the answer is False and the caller falls back to
    ``_drop_faces_in_bad_cells``."""
    global _FAR_CORNER_OK
    if _FAR_CORNER_OK is None:
        _FAR_CORNER_OK = _probe_far_corner_mask()
    return _FAR_CORNER_OK


def _probe_far_corner_mask():
    try:
        from skimage.measure import marching_cubes
        ax = np.arange(5.0)
        x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
        # an off-lattice centre: every face lies strictly inside one cube, so its centroid names it
        field = np.sqrt((x - 2.3) ** 2 + (y - 2.4) ** 2 + (z - 2.6) ** 2)
        v0, f0, _, _ = marching_cubes(field, 1.7)
        keep = np.ones(field.shape, dtype=bool)
        keep[2, 2, 2] = False                         # the far corner of cube (1, 1, 1)
        v1, f1, _, _ = marching_cubes(field, 1.7, mask=keep)
        c0 = v0[f0].mean(axis=1)
        gone = (np.floor(c0) == 1).all(axis=1)       # the faces of cube (1, 1, 1)
        if not gone.any() or len(f1) != len(f0) - int(gone.sum()):
            return False
        a = np.sort(c0[~gone], axis=0)
        b = np.sort(v1[f1].mean(axis=1), axis=0)
        return bool(a.shape == b.shape and np.allclose(a, b, atol=1e-5))
    except Exception:  # noqa: BLE001 - any failure to probe means "do not rely on it"
        return False


def _drop_faces_in_bad_cells(verts, faces, spacing, bad_cell):
    """The FALLBACK for a scikit-image whose ``mask=`` is not indexed by a cube's far corner: drop
    every face that lies in a grid cell with a non-finite corner, then the vertices nothing uses
    any more. Conservative: a face lying exactly in a lattice plane that a bad cell shares is
    dropped too, which the mask does not do. Its working arrays scale with the number of faces.

    A marching-cubes triangle lies inside ONE cell, its vertices on that cell's edges, so in index
    space (vertex / spacing) the cell is the integer box holding all three. Per axis the cells that
    can hold a face with extent [lo, hi] are ceil(hi - 1) .. floor(lo): one cell, except for a face
    that lies exactly in a lattice plane (lo == hi == integer), which belongs to the cells on BOTH
    sides - and is dropped if either is bad. (1e-9 absorbs float noise in the vertex positions.)
    """
    P = (verts / spacing)[faces]                       # (M, 3 corners, 3 axes) in index space
    lo_c, hi_c = P.min(axis=1), P.max(axis=1)
    first = np.ceil(hi_c - 1.0 - 1e-9).astype(int)
    last = np.floor(lo_c + 1e-9).astype(int)
    top = np.array(bad_cell.shape) - 1
    first = np.clip(first, 0, top)
    last = np.maximum(np.clip(last, 0, top), first)
    bad = np.zeros(len(faces), dtype=bool)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                c = first + np.array([dx, dy, dz])
                valid = (c <= last).all(axis=1)
                c = np.minimum(c, top)
                bad |= valid & bad_cell[c[:, 0], c[:, 1], c[:, 2]]
    keep = faces[~bad]
    if len(keep) == 0:
        return verts[:0], keep
    used, inverse = np.unique(keep, return_inverse=True)
    return verts[used], inverse.reshape(keep.shape)
