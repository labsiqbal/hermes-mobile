#!/usr/bin/env node
// Offline URL adapter regression: executes the hub's real inline adapter, no browser/network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../../design/parity-compare/index.html', import.meta.url), 'utf8');
const adapter = html.match(/<script id="entry-paths">([\s\S]*?)<\/script>/)?.[1];
assert.ok(adapter, 'hub exposes its inline entry-path adapter');
const tags = [...html.matchAll(/<(a|iframe)\b([^>]*)>/g)].map(([, tagName, attributes]) => ({
  tagName,
  attributes: Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
}));
assert.equal(tags.length, 4, 'both standalone links and both frames are covered');
for (const tag of tags) {
  assert.ok(['shell', 'workspace'].includes(tag.attributes['data-entry']));
  if (tag.tagName === 'iframe') {
    assert.equal('src' in tag.attributes, false, 'no initial wrong-path iframe fetch');
    assert.equal('srcdoc' in tag.attributes, false);
  } else {
    assert.equal(tag.attributes.href, tag.attributes['data-entry'] === 'shell'
      ? '../parity-shell/index.html' : '../parity-workspace/index.html', 'file links work before JS');
  }
}

const cases = [
  ['file:///offline/design/parity-compare/index.html', 'file:///offline/design/parity-shell/index.html', 'file:///offline/design/parity-workspace/index.html'],
  ['file:///offline/design/parity-compare/index.html?src=https://untrusted.invalid/#both', 'file:///offline/design/parity-shell/index.html', 'file:///offline/design/parity-workspace/index.html'],
  ['http://preview.invalid/reviews/desktop-parity/parity-compare/', 'http://preview.invalid/reviews/desktop-parity/parity-shell/', 'http://preview.invalid/reviews/desktop-parity/parity-workspace/'],
  ['https://preview.invalid/reviews/desktop-parity/parity-compare/', 'https://preview.invalid/reviews/desktop-parity/parity-shell/', 'https://preview.invalid/reviews/desktop-parity/parity-workspace/'],
  ['https://preview.invalid/reviews/desktop-parity/parity-compare/index.html', 'https://preview.invalid/reviews/desktop-parity/parity-shell/', 'https://preview.invalid/reviews/desktop-parity/parity-workspace/'],
  ['https://preview.invalid/reviews/desktop-parity/parity-compare/?src=https://untrusted.invalid/#https://untrusted.invalid/', 'https://preview.invalid/reviews/desktop-parity/parity-shell/', 'https://preview.invalid/reviews/desktop-parity/parity-workspace/'],
];
const results = [];
for (const [base, shell, workspace] of cases) {
  const nodes = tags.map(tag => ({
    tagName: tag.tagName.toUpperCase(),
    dataset: { entry: tag.attributes['data-entry'] },
    attributes: { ...tag.attributes },
    writes: [],
    setAttribute(name, value) { this.attributes[name] = value; this.writes.push([name, value]); },
  }));
  const context = vm.createContext({
    location: new URL(base),
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, 'a[data-entry],iframe[data-entry]');
        return nodes;
      },
    },
  });
  vm.runInContext(adapter, context, { timeout: 1000 });
  for (const node of nodes) {
    const attribute = node.tagName === 'IFRAME' ? 'src' : 'href';
    assert.equal(node.writes.length, 1, 'one explicit destination assignment per element');
    assert.equal(node.writes[0][0], attribute);
    const value = node.attributes[attribute];
    assert.equal(new URL(value, base).href, node.dataset.entry === 'shell' ? shell : workspace);
    if (base.startsWith('http')) assert.ok(value.endsWith('/'), 'web destinations end with slash');
    else assert.ok(value.endsWith('/index.html'), 'file destinations name the document');
  }
  for (const entry of ['https://untrusted.invalid/', '../other/index.html', '__proto__', 'constructor']) {
    assert.throws(() => vm.runInContext(`entryURL(${JSON.stringify(entry)}, location.protocol)`, context), /Unknown prototype entry/);
  }
  results.push({ base, shell, workspace, status: 'passed' });
}
console.log(JSON.stringify({ status: 'passed', type: 'offline-hub-entry-path-regression', cases: results.length, results }, null, 2));
