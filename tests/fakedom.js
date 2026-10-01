// A DOM JUST BIG ENOUGH for the panel and the plugin registry's own elements -
// no browser, no jsdom. Not a test: required by tests/plugin_rows.js.
//
//     const D = require('./fakedom.js');
//     global.document = D.document;
//     const el = document.createElement('div');
//     D.html(el)                  // a stable serialisation: tag, sorted attributes, text, children
//
// What it models is what src/parts/panel.js and src/parts/plugins.js use:
// createElement / createDocumentFragment, setAttribute / getAttribute, appendChild /
// removeChild / remove, textContent, classList.contains, lastElementChild, style
// (cssText and plain properties), addEventListener + fire(), and walking by `children`.
// It does NOT model selectors: code under test finds its elements by reference, and a
// test that needs a selector uses find().
'use strict';

class El {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.attrs = {};
        this.children = [];
        this.parentNode = null;
        this.listeners = {};
        this.style = { cssText: '' };
        this._text = '';
        this.hidden = false;
        this.checked = false;
        this.value = '';
    }
    setAttribute(k, v) {
        this.attrs[k] = String(v);
        if (k === 'checked') this.checked = true;
        if (k === 'value') this.value = String(v);
        if (k === 'hidden') this.hidden = true;
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this.attrs.class || ''; }
    get classList() {
        const self = this;
        return { contains: (c) => (self.attrs.class || '').split(/\s+/).includes(c) };
    }
    get lastElementChild() { return this.children.length ? this.children[this.children.length - 1] : null; }
    get firstChild() { return this.children[0] || null; }
    get childNodes() { return this.children; }
    get parentElement() { return this.parentNode; }
    appendChild(c) {
        if (c.isFragment) {
            for (const k of c.children.splice(0)) this.appendChild(k);
            return c;
        }
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        this.children.push(c);
        return c;
    }
    removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() {
        return this._text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) { this.children.length = 0; this._text = String(v); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    /** Fire an event the way a browser does: handlers see the control as e.target. */
    fire(t) { for (const fn of this.listeners[t] || []) fn({ target: this, type: t }); }
}

function fragment() { const f = new El('#fragment'); f.isFragment = true; return f; }

const document = {
    createElement: (tag) => new El(tag),
    createDocumentFragment: fragment,
};

/** Depth-first search by predicate. */
function find(root, pred, out) {
    out = out || [];
    if (pred(root)) out.push(root);
    for (const c of root.children) find(c, pred, out);
    return out;
}

/** A stable serialisation, for "byte-identical" comparisons. */
function html(n) {
    const a = Object.keys(n.attrs).sort().map((k) => ' ' + k + '="' + n.attrs[k] + '"').join('');
    const st = n.style.cssText ? ' style="' + n.style.cssText + '"' : '';
    return '<' + n.tagName + a + st + (n.hidden ? ' hidden' : '') + '>' + n._text
        + n.children.map(html).join('') + '</' + n.tagName + '>';
}

module.exports = { El, document, find, html };
