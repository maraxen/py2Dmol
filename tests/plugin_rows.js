// R5: A PLUGIN'S STYLE-PANEL ROWS AND ITS LEGEND - registry + panel.js, no browser.
//
//     node tests/plugin_rows.js
//
// parts/plugins.js asks a plugin for `rows(ctx)` (Style-panel rows as DATA, the schema of
// parts/panel.js's STYLE_PANEL_ROWS) and `legend(ctx)` (`[{label, color, note?, group?}]`),
// refuses what is malformed, and hands the panel's rows to parts/panel.js's syncPluginRows
// through `renderer._syncPluginPanel`. The legend is one element inside the viewer's own box.
// The DOM is tests/fakedom.js; the real pixels are tests/plugin_rows_browser.py.
//
//   * a plugin with no rows() and no legend() adds NOTHING: no hook call, no element
//   * the schema is checked and a refusal is an error state, never a throw into the frame
//   * the panel for a viewer WITHOUT plugins is the panel it always was, byte for byte:
//       - against the same code with the registry loaded and a plugin that has no rows
//       - and, when PANEL_BASE=<tree> names another tree (a tree without plugin rows), against ITS
//         parts/panel.js
//   * a row's handler calls setOption(viewer, plugin, key, value)
//   * values update IN PLACE (a slider being dragged is not rebuilt under the hand)
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

const load = (root, rel) => (0, eval)(fs.readFileSync(path.join(root, rel), 'utf8'));
function fresh() {
    global.window = { addEventListener() {}, dispatchEvent() {} };
    logged.error.length = 0; logged.warn.length = 0;
    load(ROOT, 'src/parts/plugins.js');
    return global.window.py2dmolPlugins;
}
function viewer(id) {
    const box = D.document.createElement('div');
    const canvas = D.document.createElement('canvas');
    box.appendChild(canvas);
    const r = { canvas, viewerId: id || 'v1', currentObjectName: 'obj', currentFrame: 0,
        renders: 0, style: 'cartoon',
        render() { this.renders++; },
        _computeViewCentre: () => ({ x: 0, y: 0, z: 0 }),
        _rotationCtx: () => ({}), _modelToView: (p) => p };
    return r;
}
const payloadFor = (name, extra) => ({ [name]: Object.assign(
    { version: '1', apiVersion: 1, options: {}, payloads: [{ object: null, frame: null, payload: {} }] }, extra) });
function attach(id, name, extra) {
    global.window.py2dmol_plugins = global.window.py2dmol_plugins || {};
    global.window.py2dmol_plugins[id] = payloadFor(name, extra);
}
const TOGGLE = (option, label, checked) => ({ kind: 'toggle', option, label, checked });
function def(over) {
    return Object.assign({ name: 'p', version: '1', apiVersion: 1, prims() {} }, over);
}

// ---- the schema -------------------------------------------------------------
let P = fresh();
ok(typeof P.validateRows === 'function' && typeof P.validateLegend === 'function',
    'the registry exposes validateRows and validateLegend');
const V = (rows) => (P.validateRows ? P.validateRows(rows) : undefined);
const VL = (e) => (P.validateLegend ? P.validateLegend(e) : undefined);
ok(V([[TOGGLE('a', 'A', true)]]) === null, 'schema: one toggle row is valid');
ok(V([[{ kind: 'select', option: 's', label: 'Style', value: 'wire',
    options: [['wire', 'Wire'], ['solid', 'Solid']] }],
    [{ kind: 'range', option: 'n', label: 'N', value: 5, min: 0, max: 10, step: 1 }]]) === null,
    'schema: a select and a range are valid');
const REFUSED = {
    'not an array': 'rows',
    'a row that is not an array': [TOGGLE('a', 'A', true)],
    'an empty row': [[]],
    'the slot kind (a plugin cannot own a div)': [[{ kind: 'slot', option: 'a', label: 'A' }]],
    'an unknown kind': [[{ kind: 'dial', option: 'a', label: 'A' }]],
    'no option': [[{ kind: 'toggle', label: 'A', checked: true }]],
    'no label': [[{ kind: 'toggle', option: 'a', checked: true }]],
    'a toggle whose checked is not a boolean': [[TOGGLE('a', 'A', 1)]],
    'a select with no options': [[{ kind: 'select', option: 's', label: 'S', value: 'a', options: [] }]],
    'a select option that is not [value, text]': [[{ kind: 'select', option: 's', label: 'S', value: 'a', options: ['a'] }]],
    'a range with min > max': [[{ kind: 'range', option: 'n', label: 'N', value: 1, min: 5, max: 1, step: 1 }]],
    'a range with a non-finite value': [[{ kind: 'range', option: 'n', label: 'N', value: NaN, min: 0, max: 5, step: 1 }]],
    'a label that is not a string': [[TOGGLE('a', 7, true)]],
    'a label of 5,000 characters': [[TOGGLE('a', 'x'.repeat(5000), true)]],
    'a hundred and one rows': Array.from({ length: 101 }, (_, i) => [TOGGLE('k' + i, 'L' + i, true)]),
    'nine items in one row': [Array.from({ length: 9 }, (_, i) => TOGGLE('k' + i, 'L' + i, true))],
    // panel.js hands a select option's THIRD element to el(), which honours `html:` as innerHTML
    'a select option with a third element (el() would read html: as markup)': [[{ kind: 'select', option: 's', label: 'S', value: 'a',
        options: [['a', 'A', { html: '<img src=x onerror=alert(1)>' }]] }]],
};
for (const [why, rows] of Object.entries(REFUSED)) {
    const m = V(rows);
    ok(typeof m === 'string' && m.length > 10, 'schema REFUSES ' + why + (m ? ' - "' + String(m).slice(0, 70) + '"' : ''));
}
ok(VL([{ label: 'A', color: '#ff0000' }, { label: 'B', color: '#00ff00', note: 'n', group: 'g' }]) === null,
    'legend schema: label + color (+ note, group) is valid');
for (const [why, e] of Object.entries({
    'not an array': 'x', 'a colour that is not #rrggbb': [{ label: 'A', color: 'red' }],
    'no label': [{ color: '#ff0000' }], 'a note that is not a string': [{ label: 'A', color: '#ff0000', note: 3 }],
    'a thousand and one entries': Array.from({ length: 1001 }, () => ({ label: 'A', color: '#ff0000' })),
})) {
    const m = VL(e);
    ok(typeof m === 'string' && m.length > 10, 'legend schema REFUSES ' + why);
}

// ---- a plugin WITHOUT rows() or legend() adds nothing -----------------------
P = fresh();
P.register(def({}));
let r = viewer();
attach('v1', 'p');
let hookCalls = 0;
r._syncPluginPanel = () => { hookCalls++; };
P.refreshUI(r);
ok(hookCalls === 0, 'a plugin with no rows() and no legend() never reaches the panel');
ok(r.canvas.parentNode.children.length === 1, '...and puts no element in the viewer\'s box');
ok(P.errors(r).length === 0, '...and has no error');

// ---- rows reach the panel ---------------------------------------------------
P = fresh();
let rowsAnswer = [[TOGGLE('shown', 'Shell', true)]];
let legendAnswer = [];
P.register(def({ title: 'Isosurfaces', rows(c) { return rowsAnswer; }, legend() { return legendAnswer; } }));
r = viewer();
attach('v1', 'p');
const delivered = [];
r._syncPluginPanel = (groups) => delivered.push(JSON.parse(JSON.stringify(groups)));
P.refreshUI(r);
ok(delivered.length === 1 && delivered[0].length === 1 && delivered[0][0].name === 'p'
    && delivered[0][0].title === 'Isosurfaces' && delivered[0][0].rows.length === 1,
    'rows(ctx) reaches syncPluginPanel as [{name, title, rows}] (title from the definition)');
P.refreshUI(r);
ok(delivered.length === 1, 'asking again with nothing changed does not call the panel again');
rowsAnswer = [[TOGGLE('shown', 'Shell', false)]];
P.refreshUI(r);
ok(delivered.length === 2 && delivered[1][0].rows[0][0].checked === false,
    'a changed answer is delivered');

P = fresh();
P.register(def({ rows() { return [[TOGGLE('x', 'X', true)]]; } }));
r = viewer(); attach('v1', 'p');
const t2 = [];
r._syncPluginPanel = (g) => t2.push(g);
P.refreshUI(r);
ok(t2.length === 1 && t2[0][0].title === 'p', 'the title defaults to the plugin\'s name');

P = fresh();
P.register(def({ rows() { return [[TOGGLE('x', 'X', true)]]; } }));
r = viewer(); attach('v1', 'p');
P.refreshUI(r);                                   // no panel yet: nothing to deliver to
const late = [];
r._syncPluginPanel = (g) => late.push(g);
P.refreshUI(r);
ok(late.length === 1, 'a panel that is mounted AFTER the first answer still receives it');

// ---- malformed rows are an error state, not a throw ------------------------
P = fresh();
P.register(def({ rows() { return [[{ kind: 'dial', option: 'a', label: 'A' }]]; } }));
r = viewer(); attach('v1', 'p');
const t3 = [];
r._syncPluginPanel = (g) => t3.push(g);
let threw = null;
try { P.refreshUI(r); } catch (e) { threw = e; }
const errs = P.errors(r);
ok(!threw, 'malformed rows() does not throw into the caller');
ok(errs.length === 1 && /rows/.test(errs[0].message) && /"p"/.test(errs[0].message),
    'malformed rows() is an error state naming the plugin and rows: ' + (errs[0] && errs[0].message.slice(0, 90)));
ok(t3.length === 0 || t3[t3.length - 1].length === 0, 'and no group is handed to the panel');
P = fresh();
P.register(def({ rows() { throw new Error('boom'); }, legend() { throw new Error('bang'); } }));
r = viewer(); attach('v1', 'p');
threw = null;
try { P.refreshUI(r); } catch (e) { threw = e; }
ok(!threw && P.errors(r).some((e) => /boom/.test(e.message)),
    'a rows() that THROWS is an error state too');

// ---- the legend -------------------------------------------------------------
P = fresh();
legendAnswer = [{ label: 'ACE -1.5', color: '#ff0000', note: 'shown 8,000 of 31,234 edges', group: 'ACE' },
    { label: 'ACE -1.0', color: '#00aa00', group: 'ACE' }];
P.register(def({ legend() { return legendAnswer; } }));
r = viewer(); attach('v1', 'p');
P.refreshUI(r);
let legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 1 && legends[0].parentNode === r.canvas.parentNode,
    'the legend is ONE element, inside the viewer\'s own box (the canvas\'s parent)');
const lt = legends[0] ? legends[0].textContent : '';
ok(/ACE -1\.5/.test(lt) && /shown 8,000 of 31,234 edges/.test(lt) && /ACE -1\.0/.test(lt),
    'it carries each label and the note: "' + lt + '"');
const swatches = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-swatch'));
ok(swatches.length === 2 && /#ff0000/i.test(swatches[0].style.cssText),
    'each entry has a swatch in its colour');
P.refreshUI(r);
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 1, 'asking again does not add a second legend');
P.setPayload(r, 'p', { options: { legend: false } });
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 0, 'the plugin\'s own `legend` option (false) removes it');
P.setOption(r, 'p', 'legend', true);
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 1, '...and true brings it back');
legendAnswer = [];
P.refreshUI(r);
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 0, 'with NO entries there is NO legend element at all');
legendAnswer = [{ label: 'x', color: 'not-a-colour' }];
P.refreshUI(r);
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 0 && P.errors(r).some((e) => /legend/.test(e.message)),
    'a malformed legend is an error state and draws no legend');
legendAnswer = [{ label: '<img src=x onerror=alert(1)>', color: '#112233' }];
P.refreshUI(r);
legends = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'));
ok(legends.length === 1 && legends[0].textContent.indexOf('<img') >= 0
    && D.find(legends[0], (n) => n.tagName === 'IMG').length === 0,
    'a label is TEXT: markup in it is not parsed');

// ---- drawing the legend into a capture --------------------------------------
P = fresh();
P.register(def({ legend() { return [{ label: 'ACE -1.5', color: '#ff0000', note: 'n1' }]; } }));
r = viewer(); attach('v1', 'p');
P.refreshUI(r);
const ops = [];
const cx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { ops.push(k + ':' + a.join('|')); }),
    set(o, k, v) { o[k] = v; if (k === 'fillStyle') ops.push('fillStyle=' + v); return true; } });
P.drawLegend(r, cx, 600, 600, 2);
const txt = ops.filter((o) => o.startsWith('fillText'));
ok(txt.some((o) => /ACE -1\.5/.test(o)) && ops.some((o) => /fillStyle=#ff0000/i.test(o)),
    'drawLegend paints each label (fillText) and swatch into a capture context');
ok(ops.some((o) => o.startsWith('fillRect')), '...on a backing box');
const ops2 = ops.length;
P.setOption(r, 'p', 'legend', false);
P.drawLegend(r, cx, 600, 600, 2);
ok(ops.length === ops2, 'drawLegend draws nothing when the legend option is off');
const r0 = viewer('v9');
P.drawLegend(r0, cx, 600, 600, 1);
ok(ops.length === ops2, 'drawLegend draws nothing for a viewer with no plugin');

// ---- an EXPORT'S legend leaves the live viewer alone -------------------
{
    const svgctx = () => { const t = []; const c = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'fillText' ? (s) => t.push(s) : () => {})),
        set(o, k, v) { o[k] = v; return true; } }); c.getSerializedSvg = () => ''; return { c, t }; };
    // a legend() that throws for the SVG painter ONLY
    P = fresh();
    P.register(def({ legend(c) { if (c.painter === 'svg') throw new Error('svg-only boom'); return [{ label: 'Live', color: '#112233' }]; } }));
    r = viewer(); attach('v1', 'p');
    P.refreshUI(r);
    const liveBefore = D.html(r.canvas.parentNode);
    const errsBefore = JSON.stringify(P.errors(r));
    const nErr = logged.error.length;
    const { c: sc, t: st1 } = svgctx();
    P.drawLegend(r, sc, 600, 600, 1);
    P.drawLegend(r, sc, 600, 600, 1);
    ok(JSON.stringify(P.errors(r)) === errsBefore && P.errors(r).length === 0 && logged.error.length === nErr,
        'an SVG export whose legend() throws leaves the live error state alone (' + P.errors(r).length + ' errors, ' + (logged.error.length - nErr) + ' new console errors)');
    ok(D.html(r.canvas.parentNode) === liveBefore && D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-error')).length === 0
        && D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend')).length === 1,
        '...no badge appears and the live DOM legend is exactly as it was');
    ok(st1.length === 0 && logged.warn.filter((m) => /svg-only boom/.test(m)).length === 1,
        '...the export draws no legend and says so once on the console (' + logged.warn.filter((m) => /svg-only boom/.test(m)).length + ' warns)');
    // and the export does not NEED a live legend: here the live one is errored, the SVG's is fine
    P = fresh();
    P.register(def({ legend(c) { if (c.painter !== 'svg') throw new Error('screen boom'); return [{ label: 'ForSvg', color: '#112233' }]; } }));
    r = viewer(); attach('v1', 'p');
    P.refreshUI(r);
    const { c: sc2, t: st2 } = svgctx();
    P.drawLegend(r, sc2, 600, 600, 1);
    ok(st2.some((s) => /ForSvg/.test(s)), 'an SVG export draws its legend even when the live legend is errored or empty');
    P = fresh();
    P.register(def({ legend(c) { return c.painter === 'svg' ? [{ label: 'ForSvg', color: '#112233' }] : []; } }));
    r = viewer(); attach('v1', 'p');
    P.refreshUI(r);
    const { c: sc3, t: st3 } = svgctx();
    P.drawLegend(r, sc3, 600, 600, 1);
    ok(st3.some((s) => /ForSvg/.test(s)) && D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend')).length === 0,
        '...and with an EMPTY live legend (no element on screen) the SVG still gets its own');
}

// ---- a legend of 1,000 entries must not outgrow the viewer --------
P = fresh();
P.register(def({ legend() { return Array.from({ length: 1000 }, (_, i) => ({ label: 'mesh' + i, color: '#112233' })); } }));
r = viewer(); attach('v1', 'p');
P.refreshUI(r);
const bigLeg = D.find(r.canvas.parentNode, (n) => n.hasAttribute('data-py2dmol-plugin-legend'))[0];
const nSw = bigLeg ? D.find(bigLeg, (n) => n.hasAttribute('data-swatch')).length : -1;
ok(bigLeg && nSw <= 30 && /\+970 more/.test(bigLeg.textContent) && /max-height/.test(bigLeg.style.cssText) && /overflow:hidden/.test(bigLeg.style.cssText),
    'the DOM legend of 1,000 entries shows at most 30, then "+970 more", and is height-capped (' + nSw + ' swatches)');
const rects = []; const words = [];
const cx2 = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { if (k === 'fillRect') rects.push(a); if (k === 'fillText') words.push(a[0]); }),
    set(o, k, v) { o[k] = v; return true; } });
P.drawLegend(r, cx2, 400, 120, 1);
const box = rects[0];
ok(box && box[1] + box[3] <= 120 && words.some((s) => /^\+\d+ more$/.test(s)) && words.length < 12,
    'drawLegend into a 120 px canvas keeps its box inside it (bottom ' + (box && box[1] + box[3]) + ' px) and ends with "' + words[words.length - 1] + '"');
const rects3 = []; const words3 = [];
const cx3 = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { if (k === 'fillRect') rects3.push(a); if (k === 'fillText') words3.push(a[0]); }),
    set(o, k, v) { o[k] = v; return true; } });
P.drawLegend(r, cx3, 1200, 360, 3);
ok(rects3[0] && rects3[0][1] + rects3[0][3] <= 360 && words3.some((s) => /^\+\d+ more$/.test(s)), 'and at a 3x export scale (bottom ' + (rects3[0] && rects3[0][1] + rects3[0][3]) + ' of 360 px)');

// ---- the registry's own work is gated to viewers that have plugins ---------
P = fresh();
r = viewer('v0');
const before = D.html(r.canvas.parentNode);
P.refreshUI(r);
ok(D.html(r.canvas.parentNode) === before, 'refreshUI on a viewer with no plugin touches nothing');

// ---- panel.js ---------------------------------------------------------------
function loadPanel(root) {
    global.window = Object.assign(global.window || {}, { py2dmolPanel: undefined });
    delete global.window.py2dmolPanel;
    load(root, 'src/parts/panel.js');
    return global.window.py2dmolPanel;
}
P = fresh();
const PAN = loadPanel(ROOT);
ok(typeof PAN.syncPluginRows === 'function', 'parts/panel.js exports syncPluginRows');
const plain = D.html(PAN.buildStylePanel());
ok(plain.length > 2000 && plain.indexOf('styleSelect') > 0, 'the plugin-free panel builds (' + plain.length + ' chars)');
ok(D.html(PAN.buildStylePanel()) === plain, 'building it twice gives the same markup');
if (process.env.PANEL_BASE) {
    const basePan = loadPanel(process.env.PANEL_BASE);
    const baseHtml = D.html(basePan.buildStylePanel());
    ok(baseHtml === plain, 'BYTE-IDENTICAL to the panel of ' + process.env.PANEL_BASE
        + ' (' + baseHtml.length + ' chars)');
    loadPanel(ROOT);
} else {
    console.log('SKIP the comparison with another tree\'s panel (set PANEL_BASE=<tree>)');
}
const PAN2 = global.window.py2dmolPanel;
const panel = PAN2.buildStylePanel();
r = viewer('vz');
const setCalls = [];
global.window.py2dmolPlugins = Object.assign(global.window.py2dmolPlugins || {}, {
    setOption(rr, name, key, value) { setCalls.push([rr, name, key, value]); } });
PAN2.syncPluginRows(r, panel, []);
ok(D.html(panel) === plain, 'syncPluginRows with NO groups leaves the panel byte-identical');
const GROUPS = [{ name: 'volume', title: 'Volume', rows: [
    [TOGGLE('visible.group.A', 'Probe A', true)],
    [TOGGLE('visible.group.B', 'Probe B', false)],
    [{ kind: 'select', option: 'style', label: 'Style', value: 'wire', half: true,
        options: [['wire', 'Wire'], ['solid', 'Solid']] }],
    [{ kind: 'range', option: 'maxEdgesPerMesh', label: 'Edges', value: 5000, min: 500, max: 10000, step: 500, half: true }],
] }];
PAN2.syncPluginRows(r, panel, JSON.parse(JSON.stringify(GROUPS)));
const hosts = D.find(panel, (n) => n.hasAttribute('data-py2dmol-plugin-rows'));
ok(hosts.length === 1 && hosts[0].parentNode === panel, 'the plugin rows are ONE group, a child of #stylePanel');
ok(/Volume/.test(hosts[0].textContent) && /Probe A/.test(hosts[0].textContent) && /Probe B/.test(hosts[0].textContent),
    'it is labelled with the plugin\'s title and carries each row');
const boxes = D.find(hosts[0], (n) => n.tagName === 'INPUT' && n.attrs.type === 'checkbox');
ok(boxes.length === 2 && boxes[0].hasAttribute('checked') && !boxes[1].hasAttribute('checked'),
    'two toggles, the first checked and the second NOT (a "false" is not the attribute checked)');
const ids = D.find(hosts[0], (n) => n.attrs.id).map((n) => n.attrs.id);
ok(new Set(ids).size === ids.length && ids.every((i) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(i)),
    'every control has a unique, plain id: ' + ids.join(','));
boxes[1].checked = true; boxes[1].fire('change');
ok(setCalls.length === 1 && setCalls[0][0] === r && setCalls[0][1] === 'volume'
    && setCalls[0][2] === 'visible.group.B' && setCalls[0][3] === true,
    'a toggle calls setOption(viewer, plugin, key, true)');
const sel = D.find(hosts[0], (n) => n.tagName === 'SELECT')[0];
sel.value = 'solid'; sel.fire('change');
ok(setCalls.length === 2 && setCalls[1][2] === 'style' && setCalls[1][3] === 'solid',
    'a select calls setOption with its value');
const rng = D.find(hosts[0], (n) => n.attrs.type === 'range')[0];
rng.value = '2500'; rng.fire('change');
ok(setCalls.length === 3 && setCalls[2][2] === 'maxEdgesPerMesh' && setCalls[2][3] === 2500,
    'a range calls setOption with a NUMBER');
// values update in place
const G2 = JSON.parse(JSON.stringify(GROUPS));
G2[0].rows[0][0].checked = false; G2[0].rows[2][0].value = 'solid';
PAN2.syncPluginRows(r, panel, G2);
const boxes2 = D.find(D.find(panel, (n) => n.hasAttribute('data-py2dmol-plugin-rows'))[0], (n) => n.tagName === 'INPUT' && n.attrs.type === 'checkbox');
ok(boxes2[0] === boxes[0] && boxes2[0].checked === false,
    'a changed VALUE updates the control IN PLACE (same element, now unchecked)');
ok(D.find(D.find(panel, (n) => n.hasAttribute('data-py2dmol-plugin-rows'))[0], (n) => n.tagName === 'SELECT')[0].value === 'solid', '...and the select');
// structure change rebuilds
const G3 = JSON.parse(JSON.stringify(GROUPS));
G3[0].rows.push([TOGGLE('visible.group.C', 'Probe C', true)]);
PAN2.syncPluginRows(r, panel, G3);
ok(/Probe C/.test(panel.textContent) && D.find(panel, (n) => n.hasAttribute('data-py2dmol-plugin-rows')).length === 1,
    'a new row rebuilds the group (still ONE group)');
PAN2.syncPluginRows(r, panel, []);
ok(D.html(panel) === plain, 'with the plugin gone the panel is byte-identical to the plain one again');

// ---- the SVG context's text is valid XML 1.0 ------------------
{
    const C2S = require('../src/core/svg.js');
    const c = new C2S(200, 100);
    c.font = '11px sans-serif';
    c.fillText('a\u0001b\u0000c\u001fd\u000be\ufffe\uffff&<>f\ud800g', 5, 20);
    c.fillText('tab\tnl\ncr\rkept é 😀', 5, 40);
    const svg = c.getSerializedSvg();
    // the characters XML 1.0 forbids: C0 controls but tab / newline / carriage return, U+FFFE/FFFF, lone surrogates
    const invalid = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    ok(!invalid.test(svg), 'an SVG legend text with control characters, U+FFFE and a lone surrogate carries none of them');
    ok(svg.indexOf('abcde&amp;&lt;&gt;fg<') > 0, 'the rest of the text is kept (and & < > are escaped)');
    ok(/é/.test(svg) && /😀/.test(svg), 'and valid non-ASCII text, including an astral character, is untouched');
    // A REAL XML PARSER (python's, through a subprocess - node has none): the file must parse
    const { spawnSync } = require('child_process');
    const parses = (text) => {
        const r = spawnSync('python3', ['-c', 'import sys, xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())'], { input: text });
        return { ok: r.status === 0, err: String(r.stderr).split('\n').filter(Boolean).pop() };
    };
    const pt = parses(svg);
    ok(pt.ok, 'the SVG with the control-character legend text PARSES as XML' + (pt.ok ? '' : ': ' + pt.err));
    // comment(): an SVG export's note that a plugin was not drawn; its message can carry anything the plugin was handed
    const c2 = new C2S(200, 100);
    c2.comment('py2dmol plugin volume not drawn: mesh id "a\u0001b\uffffc" -- bad <x> & trailing-');
    c2.comment('ends with dashes ---');
    c2.comment('lone \ud800 surrogate and \u0000 nul');
    const svg2 = c2.getSerializedSvg();
    ok(!invalid.test(svg2), 'comment() strips the characters XML 1.0 forbids too');
    const pc = parses(svg2);
    ok(pc.ok, 'the SVG with those comments PARSES as XML (no "--", no trailing "-", no control characters)' + (pc.ok ? '' : ': ' + pc.err));
    ok(/mesh id "abc" - bad  x  & trailing-/.test(svg2), 'and what is left of the message is readable');
}

console.log(bad ? 'plugin rows: FAILED ' + bad : 'plugin rows: ok');
process.exit(bad ? 1 : 0);
