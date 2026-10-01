// py2Dmol `volume` plugin: isosurface shells as wireframe (default) or solid triangles.
//
// SHIPPED AS WRITTEN, NOT BUILT: this file is read by py2Dmol/viewer.py and inlined, once
// per viewer that carries a volume payload, as its own <script> - it is NOT in any of the
// five bundles, so a viewer that never calls view.add_volume pays nothing for it. It uses
// only the plugin API in docs/PLUGINS.md (registers with window.py2dmolPlugins whether it
// runs before or after the library). It must never contain the two sequences register_plugin
// refuses: a closing script tag and an HTML comment opener.
//
// PAYLOAD (one per view.add_volume call; several accumulate):
//   {"meshes": [{"id": str, "label": str, "group": str|null, "level": number|null,
//                "color": "#rrggbb", "vertices": [[x,y,z], ...]   // model-space Angstrom
//                "faces": [[i,j,k], ...]}],
//    "options": {...}}                                            // defaults, optional
// OPTIONS (plugin level, over the payload's own): style "wire"|"solid", maxEdgesPerMesh,
//   lineWidth (Angstrom), legend (bool), "visible.mesh.<id>" and "visible.group.<group>"
//   (bool; absent means shown).
// BUDGET: the visible primitives are cut to floor(0.9 * ctx.maxPrims) - 7,200 on the 2D
//   painter, 54,000 on the GPU - and each mesh to maxEdgesPerMesh (10,000) first, by taking
//   every n-th primitive in a FIXED order (no randomness, so nothing shimmers between frames).
//   That is SUBSAMPLING, not geometric decimation; the legend says "shown N of M edges".
//   Not supported: translucency, a global opacity, per-vertex colour.
(function () {
'use strict';
var P = window.py2dmolPlugins = window.py2dmolPlugins || { list: [], pending: [] };

var NAME = 'volume';
var VERSION = '1.0';
var DEFAULTS = { style: 'wire', maxEdgesPerMesh: 10000, lineWidth: 0.1 };
var LIM = { meshes: 500, vertices: 1000000, faces: 2000000, totalFaces: 4000000, text: 300, id: 287, group: 286 };   // id and group: their "visible.mesh." / "visible.group." option keys must fit the panel's 300
var HEX = /^#[0-9a-fA-F]{6}$/;
var MAX_MESH_ROWS = 90;       // rows(): the registry takes 100 in all, and the controls need a few

function bad(msg) { throw new Error('volume: ' + msg); }
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// ------------------------------------------------------------------ hashing --
// A change detector for the GPU key, computed ONCE per payload (never per frame).
var F32 = new Float32Array(1);
var U32 = new Uint32Array(F32.buffer);
function Hash() { this.h = 0x811c9dc5 | 0; }
Hash.prototype.word = function (v) { this.h = Math.imul(this.h ^ (v | 0), 16777619); };
Hash.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.word(s.charCodeAt(i)); this.word(-1); };
Hash.prototype.num = function (x) { F32[0] = x; this.word(U32[0]); };
Hash.prototype.hex = function () { return (this.h >>> 0).toString(16); };

// ------------------------------------------------------------ the payload ---
// ONE MESH, validated and prepared: flat typed arrays, the UNIQUE undirected edges (each
// triangle edge once, in order of first appearance over the faces), the extent and a
// content hash. Throws a clear message for anything malformed; the registry shows it in the
// plugin's error state and draws nothing of this plugin.
function prepareMesh(m, i, budget) {
    var where = 'mesh #' + i + (m && typeof m.id === 'string' ? ' ("' + m.id.slice(0, 40) + '")' : '');
    if (!m || typeof m !== 'object') bad(where + ' is not an object');
    if (typeof m.id !== 'string' || !m.id || m.id.length > LIM.id) bad(where + ': id must be a non-empty string of at most ' + LIM.id + ' characters');
    var label = (m.label === undefined || m.label === null) ? m.id : m.label;
    if (typeof label !== 'string' || label.length > LIM.text) bad(where + ': label must be a string');
    var group = (m.group === undefined || m.group === null) ? null : m.group;
    if (group !== null && (typeof group !== 'string' || !group || group.length > LIM.group)) bad(where + ': group must be a string of at most ' + LIM.group + ' characters, or null');
    var level = (m.level === undefined || m.level === null) ? null : m.level;
    if (level !== null && !isNum(level)) bad(where + ': level must be a finite number or null');
    if (typeof m.color !== 'string' || !HEX.test(m.color)) bad(where + ': color must be written #rrggbb');
    var verts = m.vertices;
    var faces = m.faces;
    if (!Array.isArray(verts) || !verts.length) bad(where + ': vertices must be a non-empty array of [x, y, z]');
    if (!Array.isArray(faces) || !faces.length) bad(where + ': faces must be a non-empty array of [i, j, k]');
    if (verts.length > LIM.vertices) bad(where + ': ' + fmt(verts.length) + ' vertices, the limit is ' + fmt(LIM.vertices));
    if (faces.length > LIM.faces) bad(where + ': ' + fmt(faces.length) + ' faces, the limit is ' + fmt(LIM.faces));
    budget.faces += faces.length;
    if (budget.faces > LIM.totalFaces) bad('more than ' + fmt(LIM.totalFaces) + ' faces in all');
    var nv = verts.length;
    var nf = faces.length;
    var V = new Float64Array(3 * nv);
    var lo = [Infinity, Infinity, Infinity];
    var hi = [-Infinity, -Infinity, -Infinity];
    var h = new Hash();
    h.str(m.id); h.str(label); h.str(group || ''); h.str(m.color); h.num(level === null ? NaN : level);
    h.word(nv); h.word(nf);
    for (var j = 0; j < nv; j++) {
        var v = verts[j];
        if (!Array.isArray(v) || v.length !== 3) bad(where + ': vertex ' + j + ' is not [x, y, z]');
        for (var k = 0; k < 3; k++) {
            var x = v[k];
            if (!isNum(x)) bad(where + ': vertex ' + j + ' has a coordinate that is not a finite number');
            V[3 * j + k] = x;
            if (x < lo[k]) lo[k] = x;
            if (x > hi[k]) hi[k] = x;
            h.num(x);
        }
    }
    var F = new Int32Array(3 * nf);
    var seen = new Set();
    var E = [];
    var edge = function (a, b) {
        if (a === b) return;
        var p = a < b ? a : b;
        var q = a < b ? b : a;
        var key = p * nv + q;
        if (seen.has(key)) return;
        seen.add(key);
        E.push(p, q);
    };
    for (var f = 0; f < nf; f++) {
        var t = faces[f];
        if (!Array.isArray(t) || t.length !== 3) bad(where + ': face ' + f + ' is not [i, j, k]');
        for (var c = 0; c < 3; c++) {
            var ix = t[c];
            if (typeof ix !== 'number' || ix !== Math.floor(ix) || ix < 0 || ix >= nv) {
                bad(where + ': face ' + f + ' refers to vertex ' + ix + ', but there are ' + nv + ' vertices (0..' + (nv - 1) + ')');
            }
            F[3 * f + c] = ix;
            h.word(ix);
        }
        edge(t[0], t[1]); edge(t[1], t[2]); edge(t[2], t[0]);
    }
    return { id: m.id, label: label, group: group, level: level, color: m.color.toLowerCase(),
        V: V, F: F, E: Int32Array.from(E), nEdges: E.length / 2, nFaces: nf, lo: lo, hi: hi, hash: h.hex() };
}

// A PAYLOAD IS PREPARED ONCE, keyed by the payload object itself (the registry hands back the
// same object every frame), so the O(vertices) work is never per frame.
var CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
function prepare(payload) {
    if (payload && typeof payload === 'object' && CACHE && CACHE.has(payload)) {
        var hit = CACHE.get(payload);
        if (hit.error) throw new Error(hit.error);
        return hit;
    }
    var out = { meshes: [], options: {}, hash: '', error: null };
    try {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.meshes)) {
            bad('the payload must be {"meshes": [...]}');
        }
        if (payload.meshes.length > LIM.meshes) bad(payload.meshes.length + ' meshes, the limit is ' + LIM.meshes);
        if (payload.options !== undefined && (payload.options === null || typeof payload.options !== 'object' || Array.isArray(payload.options))) {
            bad('options must be an object');
        }
        var budget = { faces: 0 };
        var h = new Hash();
        for (var i = 0; i < payload.meshes.length; i++) {
            var m = prepareMesh(payload.meshes[i], i, budget);
            out.meshes.push(m);
            h.str(m.hash);
        }
        out.options = payload.options || {};
        out.hash = h.hex();
    } catch (err) {
        out.error = err.message;
    }
    if (payload && typeof payload === 'object' && CACHE) CACHE.set(payload, out);
    if (out.error) throw new Error(out.error);
    return out;
}

// Every applicable payload, as one list of meshes. Duplicate ids across payloads are an error:
// a visibility option names a mesh by id.
function gather(ctx) {
    var meshes = [];
    var hashes = [];
    var popts = Object.create(null);
    var ids = new Set();
    for (var i = 0; i < ctx.payloads.length; i++) {
        var prep = prepare(ctx.payloads[i].payload);
        for (var k in prep.options) popts[k] = prep.options[k];
        for (var j = 0; j < prep.meshes.length; j++) {
            var m = prep.meshes[j];
            if (ids.has(m.id)) bad('mesh id "' + m.id.slice(0, 40) + '" appears twice (ids must be unique across add_volume calls)');
            ids.add(m.id);
            meshes.push(m);
        }
        hashes.push(ctx.payloads[i].index + ':' + prep.hash);
    }
    return { meshes: meshes, hashes: hashes, popts: popts };
}

// ----------------------------------------------------------------- options --
function opt(ctx, popts, k) {
    if (ctx.options[k] !== undefined) return ctx.options[k];
    if (popts[k] !== undefined) return popts[k];
    return DEFAULTS[k];
}
function settings(ctx, popts) {
    var style = opt(ctx, popts, 'style');
    if (style !== 'wire' && style !== 'solid') bad('option style must be "wire" or "solid", not ' + JSON.stringify(style));
    var per = opt(ctx, popts, 'maxEdgesPerMesh');
    if (!isNum(per) || per < 1) bad('option maxEdgesPerMesh must be a number >= 1');
    var lw = opt(ctx, popts, 'lineWidth');
    if (!isNum(lw) || lw <= 0) bad('option lineWidth must be a number > 0 (Angstrom)');
    return { style: style, perMesh: Math.floor(per), lineWidth: lw };
}
function visible(m, o) {
    return o['visible.mesh.' + m.id] !== false && !(m.group && o['visible.group.' + m.group] === false);
}

// ------------------------------------------------------------------ budget --
// How many primitives each mesh may emit: the per-mesh cap first, then - if the sum is still
// over `budget` - WATER-FILLING: meshes in order of size (ties by index), each takes the lesser
// of everything it has and an equal share of what is left among the meshes still to come. So the
// smaller meshes keep all they have, the larger split the rest, and the remainder of the integer
// division falls to the largest. Deterministic, and the sum is EXACTLY `budget` whenever the
// meshes together were over it (the last, largest mesh always has room for what is left).
function allocate(sizes, perMesh, budget) {
    var cap = sizes.map(function (s) { return Math.min(s, perMesh); });
    var total = 0;
    for (var i = 0; i < cap.length; i++) total += cap[i];
    if (total <= budget) return cap;
    var order = cap.map(function (c, i) { return i; }).sort(function (a, b) { return cap[a] - cap[b] || a - b; });
    var out = new Array(cap.length);
    var left = budget;
    for (var q = 0; q < order.length; q++) {
        var m = order[q];
        var take = Math.min(cap[m], Math.floor(left / (order.length - q)));
        out[m] = take;
        left -= take;
    }
    return out;
}
// the j-th of k primitives taken from n: a FIXED stride, strictly increasing, exactly k
function pick(n, k, j) { return Math.floor(j * n / k); }

// ------------------------------------------------------------------ plugin --
var def = {
    name: NAME, title: 'Volume', version: VERSION, apiVersion: 1,
    options: {},

    init: function () { return { stats: {}, warned: {} }; },

    // the payload arrived or changed: validate it now, so a bad one is an error state at once
    setPayload: function (ctx) { gather(ctx); },

    // EVERYTHING THAT CHANGES THE DRAWING, and nothing per frame beyond string joins: the
    // payloads' content hashes (computed once), the style, the budget options and which meshes
    // are visible. (The registry also folds the viewer's options and the GPU cap into its own
    // key; this one is the plugin's own contract and is tested alone.)
    key: function (ctx) {
        var g = gather(ctx);
        var s = settings(ctx, g.popts);
        var bits = '';
        for (var i = 0; i < g.meshes.length; i++) bits += visible(g.meshes[i], ctx.options) ? '1' : '0';
        return [g.hashes.join(','), s.style, s.perMesh, s.lineWidth, bits].join('|');
    },

    // the extent of EVERY mesh, shown or not, so the fit does not move when one is toggled
    bounds: function (ctx) {
        var g = gather(ctx);
        if (!g.meshes.length) return null;
        var lo = [Infinity, Infinity, Infinity];
        var hi = [-Infinity, -Infinity, -Infinity];
        for (var i = 0; i < g.meshes.length; i++) {
            for (var k = 0; k < 3; k++) {
                if (g.meshes[i].lo[k] < lo[k]) lo[k] = g.meshes[i].lo[k];
                if (g.meshes[i].hi[k] > hi[k]) hi[k] = g.meshes[i].hi[k];
            }
        }
        return { min: lo, max: hi };
    },

    prims: function (ctx) {
        var g = gather(ctx);
        var s = settings(ctx, g.popts);
        var solid = s.style === 'solid';
        var shown = g.meshes.filter(function (m) { return visible(m, ctx.options); });
        var budget = Math.max(0, Math.floor(0.9 * ctx.maxPrims));
        var sizes = shown.map(function (m) { return solid ? m.nFaces : m.nEdges; });
        var take = allocate(sizes, s.perMesh, budget);
        var st = ctx.instance || { stats: {}, warned: {} };
        var rec = { unit: solid ? 'triangles' : 'edges', per: Object.create(null), shown: 0, available: 0 };
        var unit = rec.unit;
        for (var i = 0; i < shown.length; i++) {
            var m = shown[i];
            var n = sizes[i];
            var k = take[i];
            rec.per[m.id] = { shown: k, available: n };
            rec.shown += k;
            rec.available += n;
            if (k < n) {
                var tag = m.id + '|' + ctx.painter + '|' + k + '|' + n;
                if (!st.warned[tag] && typeof console !== 'undefined') {
                    st.warned[tag] = true;
                    console.warn('py2Dmol volume: mesh "' + m.label + '" shows ' + fmt(k) + ' of ' + fmt(n) + ' ' + unit
                        + ' on the ' + ctx.painter + ' painter (budget ' + fmt(budget) + ' in all, ' + fmt(s.perMesh)
                        + ' per mesh): every ' + (n / Math.max(k, 1)).toFixed(1) + 'th is drawn - subsampling, not decimation.');
                }
            }
            var V = m.V;
            var o = { color: m.color, width: s.lineWidth };
            for (var j = 0; j < k; j++) {
                var e = pick(n, k, j);
                if (solid) {
                    var a = m.F[3 * e]; var b = m.F[3 * e + 1]; var c = m.F[3 * e + 2];
                    ctx.tri([V[3 * a], V[3 * a + 1], V[3 * a + 2]], [V[3 * b], V[3 * b + 1], V[3 * b + 2]],
                        [V[3 * c], V[3 * c + 1], V[3 * c + 2]], o);
                } else {
                    var p = m.E[2 * e]; var q = m.E[2 * e + 1];
                    ctx.line([V[3 * p], V[3 * p + 1], V[3 * p + 2]], [V[3 * q], V[3 * q + 1], V[3 * q + 2]], o);
                }
            }
        }
        st.stats[ctx.painter] = rec;
    },

    // ONE ROW PER MESH GROUP (a mesh with no group is its own), then Style, how many edges per
    // mesh, and the legend. A group's checkbox sets "visible.group.<group>"; a lone mesh's
    // sets "visible.mesh.<id>". Values come from ctx.options, so the panel always shows what
    // is drawn.
    rows: function (ctx) {
        var g = gather(ctx);
        var o = ctx.options;
        var rows = [];
        var done = {};
        for (var i = 0; i < g.meshes.length && rows.length < MAX_MESH_ROWS; i++) {
            var m = g.meshes[i];
            var key = m.group ? 'visible.group.' + m.group : 'visible.mesh.' + m.id;
            if (done[key]) continue;
            done[key] = true;
            var members = g.meshes.filter(function (x) { return (m.group ? x.group === m.group : x.id === m.id); });
            rows.push([{ kind: 'toggle', option: key, label: m.group || m.label, checked: o[key] !== false,
                title: members.map(function (x) { return x.label; }).join(', ').slice(0, 500) }]);
        }
        if (!g.meshes.length) return rows;
        var s = settings(ctx, g.popts);
        rows.push([{ kind: 'select', option: 'style', label: 'Style', half: true, value: s.style,
            options: [['wire', 'Wire'], ['solid', 'Solid']],
            title: 'Wire: every mesh edge once. Solid: opaque flat-lit triangles (no translucency).' },
            { kind: 'range', option: 'maxEdgesPerMesh', label: 'Edges', half: true, min: 500, max: 10000,
                step: 500, value: Math.max(500, Math.min(10000, s.perMesh)),
                title: 'At most this many edges (triangles, in Solid) per mesh. Over it, every n-th is drawn.' }]);
        rows.push([{ kind: 'toggle', option: 'legend', label: 'Legend', checked: o.legend !== false }]);
        return rows;
    },

    // one entry per VISIBLE mesh, grouped; the note says how much of it is drawn when that is
    // less than all of it (what the last frame on THIS viewer's painter emitted)
    legend: function (ctx) {
        var g = gather(ctx);
        var rec = ctx.instance && ctx.instance.stats[ctx.painter];
        var out = [];
        for (var i = 0; i < g.meshes.length; i++) {
            var m = g.meshes[i];
            if (!visible(m, ctx.options)) continue;
            var r = rec && rec.per[m.id];
            out.push({ label: m.label, color: m.color, group: m.group || undefined,
                note: (r && r.shown < r.available) ? 'shown ' + fmt(r.shown) + ' of ' + fmt(r.available) + ' ' + rec.unit : undefined });
        }
        return out;
    },
};
def.__test = { prepare: prepare, allocate: allocate, pick: pick, gather: gather };

if (P.register) P.register(def); else P.pending.push(def);
})();
