// THE `volume` PLUGIN, in node: the shipped file (py2Dmol/resources/plugins/volume.js) run
// through the real registry (src/parts/plugins.js) with a recording `g` instead of a painter.
//
//     node tests/volume_plugin.js
//
// The pixels (both painters, capture, the panel, the legend on screen) are
// tests/volume_browser.py. Here:
//
//   * payload validation: every malformed shape is an ERROR STATE naming the plugin and the
//     problem - never a throw into the caller, and nothing of the plugin is drawn
//   * unique edges: a cube of 12 triangles is 18 edges (12 + a diagonal per face), an
//     icosphere of 80 faces is 120 - each undirected edge ONCE
//   * the budget: the visible primitives never exceed floor(0.9 * maxPrims), each mesh is
//     capped at maxEdgesPerMesh first, the subsampling is a FIXED stride (same input, same
//     lines, frame after frame), and what is shown versus available is REPORTED
//   * key(): moves exactly when the drawing moves (visibility, style, budget, width, the
//     payload's content) and not when it does not (the legend option, an unrelated option)
//   * bounds(), rows(), legend(), and the wire / solid prims
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const D = require('./fakedom.js');

const logged = { error: [], warn: [] };
global.console = { log: console.log, error: (m) => logged.error.push(String(m)),
    warn: (m) => logged.warn.push(String(m)) };
global.document = D.document;
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) bad++; };
const load = (rel) => (0, eval)(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function boot() {
    global.window = { addEventListener() {}, dispatchEvent() {} };
    logged.error.length = 0; logged.warn.length = 0;
    load('src/parts/plugins.js');
    load('py2Dmol/resources/plugins/volume.js');
    const P = global.window.py2dmolPlugins;
    return { P, def: P.list.find((d) => d.name === 'volume') };
}

// ---- geometry ----------------------------------------------------------------
function cube(id, over) {
    const vertices = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) vertices.push([x, y, z]);
    const faces = [];
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
        faces.push([a, b, c], [a, c, d]);
    }
    return Object.assign({ id, label: 'Cube ' + id, group: null, level: -1, color: '#ff0000', vertices, faces }, over);
}
function icosphere(id, subdiv, r, centre, over) {
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
        [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
        [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < subdiv; s++) {
        const mid = new Map();
        const get = (a, b) => {
            const k = a < b ? a + ':' + b : b + ':' + a;
            if (!mid.has(k)) { V.push(V[a].map((x, i) => (x + V[b][i]) / 2)); mid.set(k, V.length - 1); }
            return mid.get(k);
        };
        const nf = [];
        for (const [a, b, c] of F) {
            const ab = get(a, b); const bc = get(b, c); const ca = get(c, a);
            nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        F = nf;
    }
    const c = centre || [0, 0, 0];
    V = V.map((p) => { const n = Math.hypot(p[0], p[1], p[2]); return p.map((x, i) => c[i] + r * x / n); });
    return Object.assign({ id, label: 'Sphere ' + id, group: null, level: -1, color: '#0000ff', vertices: V, faces: F }, over);
}

// ---- a viewer and a recording frame ------------------------------------------
function viewer(id) {
    const box = D.document.createElement('div');
    const canvas = D.document.createElement('canvas');
    box.appendChild(canvas);
    return { canvas, viewerId: id || 'v1', currentObjectName: 'obj', currentFrame: 0, style: 'cartoon',
        renders: 0, render() { this.renders++; },
        _computeViewCentre: () => ({ x: 0, y: 0, z: 0 }), _rotationCtx: () => ({}), _modelToView: (p) => p };
}
function attach(id, payloads, options) {
    global.window.py2dmol_plugins = global.window.py2dmol_plugins || {};
    global.window.py2dmol_plugins[id] = { volume: { version: '1.0', apiVersion: 1, options: options || {},
        payloads: payloads.map((p) => ({ object: null, frame: null, payload: p })) } };
}
function frame(r, gpu) {
    r._probeOnly = !!gpu;
    const g = { renderer: r, object: { maxExtent: 30 }, ctx: {}, prims: [], scale: 10, persp: false,
        displayWidth: 600, displayHeight: 600, light: [0, 0, 1],
        project: (x, y, z) => [x, y, z, 1] };
    return g;
}
function setup(payloads, options, id) {
    const { P, def } = boot();
    const r = viewer(id);
    attach(r.viewerId, Array.isArray(payloads) ? payloads : [payloads], options);
    return { P, def, r };
}
function draw(s, gpu) {
    const g = frame(s.r, gpu);
    s.P.collect(g);
    return g.prims;
}
const lines = (prims) => prims.filter((p) => p.kind === 'line');
const key = (p) => p.pA.map((x) => x.toFixed(6)).join(',') + '>' + p.pB.map((x) => x.toFixed(6)).join(',');

// ---- the plugin registers, and ships nothing it must not ---------------------
{
    const { P, def } = boot();
    ok(def && def.name === 'volume' && def.apiVersion === 1 && P.rejected.length === 0,
        'the shipped file registers as "volume" against apiVersion 1 and is not refused');
    const src = fs.readFileSync(path.join(ROOT, 'py2Dmol/resources/plugins/volume.js'), 'utf8');
    ok(!/<\/script/i.test(src) && !/<!--/.test(src), 'the source has neither a closing script tag nor an HTML comment opener');
}

// ---- unique edges -------------------------------------------------------------
{
    const s = setup({ meshes: [cube('c')] });
    const L = lines(draw(s));
    ok(L.length === 18, 'a cube of 12 triangles draws 18 unique edges (12 edges + a diagonal on each of 6 faces): ' + L.length);
    ok(new Set(L.map(key)).size === 18 && new Set(L.map((p) => [key(p), p.pB.join() + '>' + p.pA.join()].sort()[0])).size === 18,
        '...each undirected edge ONCE (none repeated in either direction)');
    const T = s.def.__test.prepare(s.r && { meshes: [icosphere('i', 1, 5)] });
    ok(T.meshes[0].nFaces === 80 && T.meshes[0].nEdges === 120,
        'an icosphere, subdivision 1, 80 faces: ' + T.meshes[0].nEdges + ' unique edges (120)');
    ok(L.every((p) => p.c.r === 255 && p.c.g === 0 && p.c.b === 0 && p.noInk === true && p.plugin === true),
        'every edge is a plugin line in the mesh\'s colour, with no ink rim');
    ok(Math.abs(L[0].wA - 0.1) < 1e-12, 'the line width is 0.1 A by default (lineWidth)');
}

// ---- malformed payloads are error states --------------------------------------
{
    const mk = (over) => ({ meshes: [cube('c', over)] });
    const CASES = {
        'a payload that is not an object': 7,
        'a payload with no meshes array': { meshes: 'x' },
        'a mesh that is not an object': { meshes: [3] },
        'no id': { meshes: [cube('c', { id: undefined })] },
        'an empty id': mk({ id: '' }),
        'a colour that is not #rrggbb': mk({ color: 'red' }),
        'a 3-digit colour': mk({ color: '#f00' }),
        'a vertex with two coordinates': mk({ vertices: [[0, 0]].concat(cube('x').vertices.slice(1)) }),
        'a NaN coordinate': mk({ vertices: [[NaN, 0, 0]].concat(cube('x').vertices.slice(1)) }),
        'an infinite coordinate': mk({ vertices: [[Infinity, 0, 0]].concat(cube('x').vertices.slice(1)) }),
        'a face index out of range': mk({ faces: [[0, 1, 8]] }),
        'a negative face index': mk({ faces: [[0, 1, -1]] }),
        'a fractional face index': mk({ faces: [[0, 1, 1.5]] }),
        'a face with two indices': mk({ faces: [[0, 1]] }),
        'no faces': mk({ faces: [] }),
        'no vertices': mk({ vertices: [] }),
        'a level that is a string': mk({ level: 'low' }),
        'a group that is a number': mk({ group: 3 }),
        'options that are a list': { meshes: [cube('c')], options: [] },
        'five hundred and one meshes': { meshes: Array.from({ length: 501 }, (_, i) => cube('m' + i)) },
        'an id of 288 characters (its visibility key would pass 300)': mk({ id: 'i'.repeat(288) }),
        'a group of 287 characters (its visibility key would pass 300)': mk({ group: 'g'.repeat(287) }),
    };
    for (const [why, payload] of Object.entries(CASES)) {
        const s = setup(payload);
        let threw = null; let prims = null;
        try { prims = draw(s); } catch (e) { threw = e; }
        const errs = s.P.errors(s.r);
        ok(!threw && prims.length === 0 && errs.length >= 1 && /"volume"/.test(errs[0].message) && /volume: /.test(errs[0].message),
            'REFUSES ' + why + (errs[0] ? ' - ' + errs[0].message.replace(/^plugin "volume": volume: /, '').slice(0, 60) : ' (NO ERROR)')
            + (threw ? ' THREW ' + threw.message : ''));
    }
    // THE LONGEST ID AND GROUP THAT FIT: their visibility option keys are exactly 300 characters, so the
    // panel rows validate and the plugin works
    const longS = setup({ meshes: [cube('i'.repeat(287), { group: 'g'.repeat(286) }), cube('j'.repeat(287))] });
    draw(longS);
    ok(longS.P.errors(longS.r).length === 0 && longS.P.uiState(longS.r).groups.length === 1
        && longS.P.uiState(longS.r).groups[0].rows.some((r) => r[0].option === 'visible.group.' + 'g'.repeat(286))
        && longS.P.uiState(longS.r).groups[0].rows.some((r) => r[0].option === 'visible.mesh.' + 'j'.repeat(287)),
        'an id of 287 and a group of 286 characters work: rows built, no error (' + longS.P.errors(longS.r).map((e) => e.message.slice(0, 80)) + ')');
    // THE SAME TABLE tests/volume_state.py runs through Python: limits are UTF-16 code units, which is what
    // .length counts here, so an emoji (two units) is held to the same answer on both sides
    const EM = '\u{1F600}';
    const TABLE = [['id', 'a'.repeat(287), true], ['id', 'a'.repeat(288), false],
        ['id', EM.repeat(143), true], ['id', EM.repeat(143) + 'a', true], ['id', EM.repeat(144), false],
        ['group', 'g'.repeat(286), true], ['group', 'g'.repeat(287), false],
        ['group', EM.repeat(143), true], ['group', EM.repeat(143) + 'a', false], ['group', EM.repeat(144), false]];
    for (const [field, text, fits] of TABLE) {
        const st = setup({ meshes: [cube(field === 'id' ? text : 'c', field === 'group' ? { group: text } : {})] });
        const pr = draw(st);
        const accepted = pr.length === 18 && st.P.errors(st.r).length === 0;
        ok(accepted === fits, 'JS: a ' + field + ' of ' + text.length + ' UTF-16 units (' + [...text].length + ' characters) '
            + (fits ? 'fits' : 'is REFUSED') + (accepted === fits ? '' : ' - WRONG: ' + st.P.errors(st.r).map((e) => e.message.slice(0, 60))));
    }
    // IDS THAT ARE ALSO NAMES ON Object.prototype are ordinary ids
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
        const sp = setup({ meshes: [cube(id)] });
        const pr = draw(sp);
        ok(pr.length === 18 && sp.P.errors(sp.r).length === 0, 'the mesh id "' + id + '" is an ordinary id: ' + pr.length + ' edges, ' + sp.P.errors(sp.r).length + ' errors'
            + (sp.P.errors(sp.r)[0] ? ' - ' + sp.P.errors(sp.r)[0].message.slice(0, 70) : ''));
    }
    const sd = setup({ meshes: [cube('__proto__'), cube('constructor')] });
    ok(draw(sd).length === 36 && sd.P.errors(sd.r).length === 0, 'two such ids in one payload do not collide with each other');
    // across payloads
    const s2 =setup([{ meshes: [cube('a')] }, { meshes: [cube('a')] }]);
    draw(s2);
    ok(s2.P.errors(s2.r).some((e) => /appears twice/.test(e.message)), 'REFUSES the same id in two payloads');
    for (const [k, v] of Object.entries({ style: 'glass', maxEdgesPerMesh: 0, lineWidth: -1 })) {
        const s = setup({ meshes: [cube('c')] }, { [k]: v });
        const prims = draw(s);
        ok(prims.length === 0 && s.P.errors(s.r).some((e) => new RegExp(k).test(e.message)), 'REFUSES the option ' + k + ' = ' + v + ' with a message naming it');
    }
    // the error clears when the payload is replaced by a good one
    const s3 = setup({ meshes: [cube('c', { color: 'red' })] });
    draw(s3);
    s3.P.setPayload(s3.r, 'volume', { payloads: [{ object: null, frame: null, payload: { meshes: [cube('c')] } }] });
    ok(draw(s3).length === 18 && s3.P.errors(s3.r).length === 0, 'replacing the payload with a good one clears the error and draws');
}

// ---- the payload is prepared ONCE ----------------------------------------------
{
    const s = setup({ meshes: [icosphere('i', 3, 5)] });
    const p = { meshes: [icosphere('i', 3, 5)] };
    const a = s.def.__test.prepare(p);
    ok(s.def.__test.prepare(p) === a, 'the same payload object is prepared once (cached by identity): its edges and hash are not rebuilt per frame');
    ok(/^[0-9a-f]+$/.test(a.hash), 'and carries a content hash: ' + a.hash);
}

// ---- the budget ---------------------------------------------------------------
{
    const ico = (id, n, over) => icosphere(id, n, 5, [0, 0, 0], over);       // subdiv 4: 5120 faces, 7680 edges
    const alloc = (sizes, per, budget) => boot().def.__test.allocate(sizes, per, budget);
    ok(JSON.stringify(alloc([100, 50], 1000, 1000)) === '[100,50]', 'allocate: under the budget everything is shown');
    ok(JSON.stringify(alloc([30720], 10000, 54000)) === '[10000]', 'allocate: one mesh is held to maxEdgesPerMesh first');
    const w = alloc([7680, 7680, 7680], 10000, 7200);
    ok(w.reduce((a, b) => a + b, 0) === 7200 && w.every((x) => x === 2400), 'allocate: three equal meshes share 7,200 equally: ' + w);
    const w2 = alloc([100, 7680, 7680], 10000, 7200);
    ok(w2[0] === 100 && w2[1] + w2[2] === 7100 && Math.abs(w2[1] - w2[2]) <= 1,
        'allocate: a small mesh keeps all it has, the large ones share the rest (' + w2 + ')');
    const w3 = alloc([5, 3, 9, 1], 100, 10);
    ok(w3.reduce((a, b) => a + b, 0) === 10 && w3.every((x, i) => x <= [5, 3, 9, 1][i]), 'allocate: the sum is EXACTLY the budget when the meshes are over it (' + w3 + ')');
    const w4 = alloc([10, 10, 10], 100, 10);
    ok(JSON.stringify(w4) === '[3,3,4]', 'allocate: the integer remainder falls to the largest (last), so three meshes of 10 sharing 10 get ' + w4);
    const w5 = alloc([5, 100, 100], 1000, 50);
    ok(JSON.stringify(w5) === '[5,22,23]' && w5.reduce((a, b) => a + b, 0) === 50, 'allocate: [5,100,100] sharing 50 get ' + w5 + ' - the small one keeps all it has');
    const stride = (n, k) => Array.from({ length: k }, (_, j) => boot().def.__test.pick(n, k, j));
    const st = stride(30720, 7200);
    ok(st[0] === 0 && st.every((x, i) => i === 0 || x > st[i - 1]) && st[st.length - 1] < 30720 && new Set(st).size === 7200,
        'pick: a fixed, strictly increasing stride (first ' + st.slice(0, 5) + ')');
    ok(st.every((x, i) => x === Math.floor(i * 30720 / 7200)) && st[st.length - 1] >= 30720 - 30720 / 7200 - 1,
        'pick: ...taking every n/k-th over the WHOLE range, not the first k (last index ' + st[st.length - 1] + ' of 30,720)');
    ok(JSON.stringify(stride(10, 10)) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'pick: k = n takes everything');

    // the real thing: a 30,720-edge mesh (subdiv 5) on both painters
    const big = { meshes: [ico('big', 5)] };
    const s2d = setup(big);
    const p2d = lines(draw(s2d, false));
    ok(p2d.length === 7200, '2D painter: 30,720 edges are cut to floor(0.9 * 8000) = 7,200 (drew ' + p2d.length + ') - the core\'s cap error is NOT tripped');
    ok(s2d.P.errors(s2d.r).length === 0, '...and there is no error state');
    const zs = p2d.map((p) => p.pA[2]).concat(p2d.map((p) => p.pB[2]));
    ok(Math.min(...zs) < -4.5 && Math.max(...zs) > 4.5, '...spread over the whole sphere, both poles reached (z from ' + Math.min(...zs).toFixed(2) + ' to ' + Math.max(...zs).toFixed(2) + ' of a 5 A sphere)');
    const sgpu = setup(big);
    const pgpu = lines(draw(sgpu, true));
    ok(pgpu.length === 10000, 'GPU: the same mesh is held to maxEdgesPerMesh = 10,000 (drew ' + pgpu.length + '; budget 54,000)');
    ok(sgpu.P.errors(sgpu.r).length === 0, '...and there is no error state');
    const again = lines(draw(s2d, false));
    ok(again.length === p2d.length && again.every((p, i) => key(p) === key(p2d[i])), 'DETERMINISTIC: the next frame draws exactly the same 7,200 lines in the same order');
    const sfresh = setup(big);
    const other = lines(draw(sfresh, false));
    ok(other.every((p, i) => key(p) === key(p2d[i])), '...and so does a fresh viewer');
    // exact budget with several meshes
    const three = setup({ meshes: [ico('a', 4), ico('b', 4, { group: 'g' }), ico('c', 4, { group: 'g' })] });
    ok(lines(draw(three, false)).length === 7200, 'three 7,680-edge meshes on the 2D painter draw EXACTLY 7,200 together');
    ok(lines(draw(three, true)).length === 3 * 7680, 'and all 23,040 on the GPU (under 54,000 and 10,000 each)');
    const opt = setup(big, { maxEdgesPerMesh: 1000 });
    ok(lines(draw(opt, true)).length === 1000, 'maxEdgesPerMesh = 1000 draws exactly 1,000');
    const bigcap = setup(big);
    bigcap.P.caps.gpu = 5000;
    ok(lines(draw(bigcap, true)).length === 4500, 'the budget follows the registry\'s cap: a GPU cap of 5,000 gives 4,500');

    // what is shown versus available is REPORTED, per painter
    draw(s2d, false); draw(sgpu, true);
    const l2d = s2d.P.uiState(s2d.r).legend;
    ok(l2d.length === 1 && l2d[0].note === 'shown 7,200 of 30,720 edges', '2D legend note: "' + (l2d[0] && l2d[0].note) + '"');
    s2d.r.useGPU = false;
    const lgpu = sgpu.P.uiState(sgpu.r).legend;
    sgpu.r.useGPU = true; sgpu.P.refreshUI(sgpu.r);
    const lgpu2 = sgpu.P.uiState(sgpu.r).legend;
    ok(lgpu2[0].note === 'shown 10,000 of 30,720 edges', 'GPU legend note: "' + lgpu2[0].note + '"');
    const loud = setup(big);
    draw(loud, false); draw(loud, false); draw(loud, false);
    const said = logged.warn.filter((m) => /shows 7,200 of 30,720 edges/.test(m) && /subsampling, not decimation/.test(m));
    ok(said.length === 1, 'the console says so ONCE over three frames, naming subsampling (' + said.length + ')');
    const small = setup({ meshes: [cube('c')] });
    draw(small, false);
    ok(small.P.uiState(small.r).legend[0].note === '', 'a mesh that is entirely drawn has no note');

    // THE LEGEND IN AN EXPORT SAYS WHAT THAT EXPORT DREW. A GPU viewer's PNG reuses the GPU mesh (measured in a
    // browser: no plugin call at all during the export), so it carries the GPU note; an SVG export is ALWAYS the
    // 2D painter and draws 7,200 edges, so the legend drawn into it must say 7,200, not the screen's 10,000.
    const ex = setup(big);
    ex.r.useGPU = true;
    draw(ex, true);                                             // the viewer's own frame: 10,000 edges
    const textOf = (ctx) => { const t = []; ctx.fillText = (s) => t.push(s); return t; };
    const mkctx = (svg) => { const c = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'getSerializedSvg' && !svg ? undefined : () => {})), set(o, k, v) { o[k] = v; return true; } }); return c; };
    ex.r.gpuDrewLastFrame = true;                              // what the export's own frame sets when the GPU drew it
    const pngCtx = mkctx(false); const pngText = textOf(pngCtx);
    ex.P.drawLegend(ex.r, pngCtx, 600, 600, 1);
    ok(pngText.some((s) => /shown 10,000 of 30,720 edges/.test(s)), 'a PNG export from a GPU viewer: the legend text says the GPU\'s 10,000: ' + pngText.join(' | ').slice(0, 80));
    const svgG = frame(ex.r, false);                            // what an SVG export does: a collect under a serialising context
    svgG.ctx = { getSerializedSvg() {}, comment() {} };
    ex.P.collect(svgG);
    ok(lines(svgG.prims).length === 7200, 'the SVG export of that viewer draws 7,200 edges (the 2D cap)');
    const svgCtx = mkctx(true); svgCtx.getSerializedSvg = () => ''; const svgText = textOf(svgCtx);
    ex.P.drawLegend(ex.r, svgCtx, 600, 600, 1);
    ok(svgText.some((s) => /shown 7,200 of 30,720 edges/.test(s)), 'the legend drawn into that SVG says 7,200, what it drew: ' + svgText.join(' | ').slice(0, 80));
    ok(ex.P.uiState(ex.r).legend[0].note === 'shown 10,000 of 30,720 edges', '...while the screen\'s legend still says 10,000');

    // A PNG THE GPU DECLINED (a very high dpi: measured, 1,500 dpi = 7,475 px, gpuDrewLastFrame = false) is drawn
    // by the 2D painter under the 2D cap: its legend must say 7,200. The signal is renderer.gpuDrewLastFrame,
    // which the export's own frame has just set (capture.js calls drawLegend straight after the render).
    const dc = setup(big);
    dc.r.useGPU = true;
    draw(dc, true);                                              // the screen: the GPU's 10,000
    dc.P.collect(frame(dc.r, false));                            // the declined export frame: the 2D painter, 7,200
    const exportText = (drew) => { dc.r.gpuDrewLastFrame = drew; const c = mkctx(false); const t = textOf(c); dc.P.drawLegend(dc.r, c, 600, 600, 1); return t.join(' | '); };
    const declined = exportText(false);
    ok(/shown 7,200 of 30,720 edges/.test(declined), 'a PNG the GPU DECLINED (gpuDrewLastFrame false): the legend says the 2D painter\'s 7,200: ' + declined.slice(0, 70));
    const drawn = exportText(true);
    ok(/shown 10,000 of 30,720 edges/.test(drawn), '...and when the GPU did draw it, the GPU\'s 10,000: ' + drawn.slice(0, 70));
    ok(dc.P.uiState(dc.r).legend[0].note === 'shown 10,000 of 30,720 edges', '...with the screen\'s legend untouched by either export');
}

// ---- solid ---------------------------------------------------------------------
{
    const s = setup({ meshes: [cube('c')] }, { style: 'solid' });
    const prims = draw(s);
    ok(prims.length === 12 && prims.every((p) => p.kind === 'joint' && p.q.length === 3 && p.two === true && p.noInk === true),
        'style solid draws the 12 triangles of a cube as opaque two-sided joint prims');
    ok(prims.every((p) => p.c.r === 255 && p.c.g === 0), '...in the mesh colour');
    const s2 = setup({ meshes: [icosphere('i', 5, 5)] }, { style: 'solid' });
    ok(draw(s2, false).filter((p) => p.kind === 'joint').length === 7200, 'solid is budgeted too: 20,480 triangles cut to 7,200 on the 2D painter');
    const note = (s2.P.uiState(s2.r).legend[0] || {}).note;
    ok(note === 'shown 7,200 of 20,480 triangles', 'and the note says triangles: "' + note + '"');
}

// ---- visibility -----------------------------------------------------------------
{
    const meshes = [cube('a', { group: 'G' }), cube('b', { group: 'G' }), icosphere('s', 1, 3, [0, 0, 0], { color: '#0000ff' })];
    const count = (opts) => { const s = setup({ meshes }, opts); const p = lines(draw(s)); return [p.filter((x) => x.c.r === 255).length, p.filter((x) => x.c.b === 255).length]; };
    ok(JSON.stringify(count({})) === '[36,120]', 'all visible: 2 cubes (36 edges) and a sphere (120)');
    ok(JSON.stringify(count({ 'visible.mesh.s': false })) === '[36,0]', '"visible.mesh.<id>": false hides that mesh');
    ok(JSON.stringify(count({ 'visible.group.G': false })) === '[0,120]', '"visible.group.<group>": false hides every mesh of the group');
    ok(JSON.stringify(count({ 'visible.mesh.a': false })) === '[18,120]', 'one mesh of a group can be hidden alone');
    ok(JSON.stringify(count({ 'visible.mesh.s': true, 'visible.group.G': true })) === '[36,120]', 'true is shown');
}

// ---- key(): moves exactly when the drawing moves ---------------------------------
{
    const { def } = boot();
    const base = { meshes: [cube('a', { group: 'G' }), cube('b')] };
    const K = (opts, payload) => def.key({ options: opts || {}, payloads: [{ index: 0, payload: payload || base }] });
    const k0 = K();
    ok(k0 === K(), 'the key is stable');
    ok(K({ 'visible.mesh.b': false }) !== k0, 'key moves with the visibility of a mesh');
    ok(K({ 'visible.group.G': false }) !== k0, '...of a group');
    ok(K({ 'visible.mesh.b': false }) !== K({ 'visible.group.G': false }), '...and says WHICH');
    ok(K({ 'visible.mesh.b': true }) === k0, 'an explicit true is the default: same drawing, same key');
    ok(K({ style: 'solid' }) !== k0, 'key moves with the style');
    ok(K({ maxEdgesPerMesh: 500 }) !== k0 && K({ maxEdgesPerMesh: 500 }) !== K({ maxEdgesPerMesh: 600 }), '...with maxEdgesPerMesh');
    ok(K({ lineWidth: 0.2 }) !== k0, '...with lineWidth');
    ok(K({ legend: false }) === k0 && K({ unrelated: 1 }) === k0, 'and NOT with the legend option or an option it does not read');
    const moved = { meshes: [cube('a', { group: 'G', vertices: cube('x').vertices.map((v, i) => (i === 0 ? [0.5, 0, 0] : v)) }), cube('b')] };
    ok(K({}, moved) !== k0, 'key moves when ONE VERTEX of the payload moves (the content hash)');
    const relabelled = { meshes: [cube('a', { group: 'G', color: '#00ff00' }), cube('b')] };
    ok(K({}, relabelled) !== k0, '...or a colour');
    const same = { meshes: [cube('a', { group: 'G' }), cube('b')] };
    ok(K({}, same) === k0, 'an identical payload (a different object) has the same key');
    ok(def.key({ options: {}, payloads: [{ index: 1, payload: base }] }) !== k0, 'a payload at another index is another key');
}

// ---- bounds ----------------------------------------------------------------------
{
    const { def } = boot();
    const b = def.bounds({ options: {}, payloads: [{ index: 0, payload: { meshes: [cube('a'),
        cube('b', { vertices: cube('x').vertices.map((v) => v.map((x) => x * 4 - 10)) })] } }] });
    ok(JSON.stringify(b) === JSON.stringify({ min: [-10, -10, -10], max: [1, 1, 1] }), 'bounds is the union of every mesh: ' + JSON.stringify(b));
    const hid = def.bounds({ options: { 'visible.mesh.b': false }, payloads: [{ index: 0, payload: { meshes: [cube('a'),
        cube('b', { vertices: cube('x').vertices.map((v) => v.map((x) => x * 4 - 10)) })] } }] });
    ok(JSON.stringify(hid) === JSON.stringify(b), '...HIDDEN meshes included, so the fit does not move when a shell is toggled');
    ok(def.bounds({ options: {}, payloads: [] }) === null, 'no payload: null');
    // through the registry's fit-to-view, with its reach cap
    const s = setup({ meshes: [icosphere('i', 1, 20, [0, 0, 0])] });
    const rad = s.P.extent(s.r, { maxExtent: 30 });
    ok(rad > 20 && rad <= 20 * Math.sqrt(3) + 1e-6, 'the registry turns the mesh extent into a fit radius (' + rad.toFixed(2) + ' A for a 20 A sphere)');
    const far = setup({ meshes: [icosphere('i', 1, 5, [1e6, 0, 0])] });
    ok(far.P.extent(far.r, { maxExtent: 30 }) === 0 && far.P.errors(far.r).some((e) => /bounds/.test(e.message)),
        'a mesh 1,000,000 A away is held to the core\'s reach cap: ignored for the fit, and an error says so');
}

// ---- rows() and legend() ----------------------------------------------------------
{
    const meshes = [cube('a', { group: 'ACE', label: 'ACE -1.0', level: -1 }), cube('b', { group: 'ACE', label: 'ACE -2.0', color: '#00ff00' }),
        cube('c', { label: 'Lone', color: '#0000ff' })];
    const s = setup({ meshes });
    draw(s);
    const groups = s.P.uiState(s.r).groups;
    ok(groups.length === 1 && groups[0].name === 'volume' && groups[0].title === 'Volume', 'rows() reaches the panel as the "Volume" group');
    const rows = groups[0].rows;
    const flat = rows.map((r) => r[0]);
    ok(flat[0].kind === 'toggle' && flat[0].option === 'visible.group.ACE' && flat[0].label === 'ACE' && flat[0].checked === true,
        'ONE ROW PER GROUP: the two ACE meshes share a checkbox "ACE" on visible.group.ACE');
    ok(flat[1].kind === 'toggle' && flat[1].option === 'visible.mesh.c' && flat[1].label === 'Lone',
        '...a mesh with no group is its own row on visible.mesh.<id>');
    ok(rows.some((r) => r.some((i) => i.kind === 'select' && i.option === 'style' && i.value === 'wire')), 'a Style select');
    ok(rows.some((r) => r.some((i) => i.kind === 'range' && i.option === 'maxEdgesPerMesh' && i.value === 10000)), 'an Edges slider');
    ok(rows.some((r) => r.some((i) => i.kind === 'toggle' && i.option === 'legend' && i.checked === true)), 'and a Legend toggle');
    s.P.setOption(s.r, 'volume', 'visible.group.ACE', false);
    s.P.setOption(s.r, 'volume', 'style', 'solid');
    s.P.setOption(s.r, 'volume', 'legend', false);
    const r2 = s.P.uiState(s.r).groups[0].rows;
    ok(r2[0][0].checked === false && r2.some((r) => r.some((i) => i.option === 'style' && i.value === 'solid'))
        && r2.some((r) => r.some((i) => i.option === 'legend' && i.checked === false)), 'the rows show the options as they are');
    ok(s.P.validateRows(rows) === null && s.P.validateRows(r2) === null, 'the rows pass the registry\'s schema');
    const many = setup({ meshes: Array.from({ length: 200 }, (_, i) => cube('m' + i, { group: 'g' + i })) });
    draw(many);
    ok(many.P.errors(many.r).length === 0 && many.P.uiState(many.r).groups[0].rows.length <= 100,
        '200 groups: the rows are held to the panel\'s limit (' + many.P.uiState(many.r).groups[0].rows.length + ') and are valid');

    // the legend
    const l = setup({ meshes });
    draw(l);
    const leg = l.P.uiState(l.r).legend;
    ok(leg.length === 3 && leg[0].label === 'ACE -1.0' && leg[0].group === 'ACE' && leg[0].color === '#ff0000'
        && leg[1].label === 'ACE -2.0' && leg[1].color === '#00ff00' && leg[2].group === '', 'legend: a swatch entry per visible mesh, grouped: ' + leg.map((e) => e.label).join(', '));
    l.P.setOption(l.r, 'volume', 'visible.mesh.b', false);
    ok(l.P.uiState(l.r).legend.map((e) => e.label).join() === 'ACE -1.0,Lone', 'a hidden mesh leaves the legend');
    l.P.setOption(l.r, 'volume', 'legend', false);
    ok(l.P.uiState(l.r).legend.length === 0, 'the legend option removes it');
    ok(D.find(l.r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend')).length === 0, '...and its element');
    l.P.setOption(l.r, 'volume', 'legend', true);
    ok(D.find(l.r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend')).length === 1, '...and true brings it back');
}

console.log(bad ? 'volume plugin: FAILED ' + bad : 'volume plugin: ok');
process.exit(bad ? 1 : 0);
