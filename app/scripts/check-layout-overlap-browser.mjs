#!/usr/bin/env node
// HM-UX-05: exercise the built App, not a CSS lookalike or React state replacement.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';

const app = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.resolve(process.argv[2] || '/tmp/hm-layout-overlap-browser');
assert.ok(!output.startsWith(path.join(app, 'dist')));
await mkdir(output, { recursive: true });
const fixture = structuredClone(FIXTURE);
const shortCode = 'https://preview.fixture.invalid:8451/';
const longCode = 'https://preview.fixture.invalid/' + 'unbroken-segment-'.repeat(30) + '\nsecond line';
fixture.historyBySession = {
  'qa-project-session': [
    { role: 'user', content: 'Show the fictional preview and code.' },
    { role: 'assistant', content: 'QA code examples\n\n```text\n' + shortCode + '\n```\n\n```sh\n' + longCode + '\n```\n\n' + Array.from({ length: 24 }, (_, n) => `Fictional history paragraph ${n + 1}. Long restored history for the layout regression; no prompt is sent.`).join('\n\n') + '\n\nQA restored answer qa-project-session' },
  ],
};
const host = await serveDist(app);
const browser = new ProductionBrowser({ origin: host.origin, assetPaths: host.assetPaths, output, deadline: 240000, timeout: 5000, chrome: '/usr/bin/google-chrome' });
const report = { evidence: 'BUILT-REACT-FICTIONAL-LAYOUT-OVERLAP', checks: [], layout: [], screenshots: [], artifact: host.hashes };
const q = JSON.stringify;
// All geometry is observed from rendered DOM, including the full 44px hit boxes.
function geometryHelpers() {
  window.__layout = {
    rect(e) { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; },
    overlap(a, b) { return Math.min(a.right, b.right) > Math.max(a.left, b.left) + .5 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + .5; },
    hit(e) { const r = e.getBoundingClientRect(); return [[.5,.5],[.5,.1],[.9,.5],[.5,.9],[.1,.5]].every(([x,y]) => { const top = document.elementFromPoint(r.left + r.width*x, r.top + r.height*y); return top === e || e.contains(top); }); },
  };
}
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProductionFixtures.toString()})(${q(fixture)});(${domHelpers.toString()})();(${geometryHelpers.toString()})();window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)}});` });
  await browser.open(host.origin + '/');
  const j = new Journeys(browser, report, output);
  const resize = async (width, height) => {
    await browser.viewport(width, height);
    await browser.waitFor(`innerWidth === ${width} && document.querySelector('#root').getBoundingClientRect().height === ${height}`);
    await browser.settle();
  };
  // Continue independent assertions on RED so every screenshot symptom is evidenced.
  const check = async (name, fn) => {
    try { const metrics = await fn(); report.checks.push({ name, status: 'passed', metrics }); }
    catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); }
  };
  const measure = async (name, expression, verify) => {
    const metrics = await browser.evaluate(expression);
    report.layout.push({ name, ...metrics });
    await check(name, () => { verify(metrics); return metrics; });
  };
  const scrollAway = async () => {
    await browser.evaluate("(()=>{const e=document.querySelector('.chat-view .body');e.scrollTop=150;e.dispatchEvent(new Event('scroll'));})()");
    await browser.waitFor("!!document.querySelector('.jump-btn')");
    await browser.settle();
  };
  const shell = async (name, selectors) => {
    await measure(name, `(()=>{const m=document.querySelector('.manage'),r=m.getBoundingClientRect();return {header:__layout.rect(document.querySelector('header')),tab:__layout.rect(document.querySelector('.shell-tabbar')),container:__layout.rect(m),scrollable:getComputedStyle(m).overflowY,viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,headers:[...document.querySelectorAll('header')].filter(__qaDOM.visible).length,tabs:[...document.querySelectorAll('.shell-tabbar')].filter(__qaDOM.visible).length,children:${q(selectors)}.map(s=>{const e=m.querySelector(s),a=e.getBoundingClientRect();return {selector:s,left:a.left,right:innerWidth-a.right,width:a.width,relativeLeft:a.left-r.left};})};})()`, m => {
      assert.equal(m.pageWidth, m.viewport[0]);
      assert.equal(m.headers, 1);
      assert.equal(m.tabs, 1);
      assert.equal(m.header.top, 0);
      assert.equal(m.tab.bottom, m.viewport[1]);
      assert.ok(m.container.top >= m.header.bottom && m.container.bottom <= m.tab.top + 1, q(m));
      assert.equal(m.scrollable, 'auto');
      for (const child of m.children) { assert.equal(child.left, 16, q(child)); assert.equal(child.right, 16, q(child)); }
    });
  };
  await j.tap(fixture.gateway.label, 'body', false);
  await j.text('QA Project conversation');
  await j.tap('QA Project conversation', 'body', false);
  await j.text('QA restored answer qa-project-session');
  for (const width of [320, 360, 390, 430]) {
    for (const height of [844, 480]) {
      const size = `${width}x${height}`;
      await resize(width, height);
      assert.equal(await browser.evaluate('innerWidth'), width);
      for (const [mode, draft] of [['single', ''], ['multiline', 'Line one\nLine two\nLine three\nLine four\nLine five']]) {
        await j.type('textarea', draft);
        await scrollAway();
        await measure(`composer-${size}-${mode}`, `(()=>{const l=__layout,els=['.jump-btn','.model-pill','.composer-pill','.conversation-tools button'].map(s=>document.querySelector(s)),rects=els.map(e=>l.rect(e));return {rects,hits:els.slice(0,2).map(e=>l.hit(e)),overlaps:rects.flatMap((a,i)=>rects.slice(i+1).map((b,k)=>i===1&&k===0?false:l.overlap(a,b))),viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,scrollTop:document.querySelector('.chat-view .body').scrollTop,textareaHeight:document.querySelector('textarea').getBoundingClientRect().height};})()`, m => {
          const [jump, model, composer] = m.rects;
          assert.ok(m.scrollTop > 0);
          assert.ok(m.overlaps.every(x => !x), q(m));
          assert.deepEqual(m.hits, [true, true]);
          assert.ok(jump.width >= 44 && jump.height >= 44 && model.width >= 44 && model.height >= 44);
          assert.ok(model.top >= composer.top && model.bottom <= composer.bottom && model.left >= composer.left && model.right <= composer.right);
          assert.ok(m.rects.every(r => r.top >= 0 && r.bottom <= height && r.left >= 0 && r.right <= width));
          assert.equal(m.pageWidth, width);
          if (mode === 'multiline') assert.ok(m.textareaHeight > 90);
        });
        await j.shot(`composer-${size}-${mode}`);
      }
      await j.type('textarea', '');
      // Scroll to code, rather than capturing a settled chat with code offscreen.
      await browser.evaluate("document.querySelectorAll('.md-codeblock pre').forEach(p=>p.scrollLeft=0);document.querySelector('.md-codeblock').scrollIntoView({block:'start'})");
      await browser.settle();
      await measure(`code-${size}`, `(()=>{const l=__layout;return {pageWidth:document.documentElement.scrollWidth,blocks:[...document.querySelectorAll('.md-codeblock')].map(e=>{const pre=e.querySelector('pre'),button=e.querySelector('button'),range=document.createRange();range.selectNodeContents(pre.querySelector('code'));return {block:l.rect(e),pre:l.rect(pre),copy:l.rect(button),text:l.rect(range),overlap:l.overlap(l.rect(pre),l.rect(button)),scrollWidth:pre.scrollWidth,clientWidth:pre.clientWidth,overflow:getComputedStyle(pre).overflowX};})};})()`, m => {
        assert.equal(m.blocks.length, 2);
        assert.equal(m.pageWidth, width);
        for (const b of m.blocks) {
          assert.equal(b.overlap, false, q(b));
          assert.ok(b.text.top >= b.copy.bottom || b.text.bottom <= b.copy.top || b.pre.right <= b.copy.left, q(b));
          assert.ok(b.copy.left >= b.block.left && b.copy.right <= b.block.right && b.copy.bottom <= b.block.bottom, q(b));
          assert.equal(b.overflow, 'auto');
        }
        assert.ok(m.blocks[1].scrollWidth > m.blocks[1].clientWidth + 100);
      });
      await j.shot(`code-${size}`);
      await check(`copy-and-horizontal-scroll-${size}`, async () => {
        for (let n = 0; n < 2; n++) {
          const selector = `.md-codeblock:nth-of-type(${n + 1})`;
          // The previous viewport's transient Copied label can expire mid-tap.
          await browser.waitFor(`document.querySelectorAll('.md-copy')[${n}].innerText === 'Copy'`);
          const copiedBefore = await browser.evaluate('window.__copied.length');
          await j.tap('Copy', selector);
          assert.equal(await browser.evaluate('window.__copied.length'), copiedBefore + 1);
          assert.equal(await browser.evaluate('window.__copied.at(-1)'), (n ? longCode : shortCode) + '\n');
        }
        const movement = await browser.evaluate("(()=>{const p=document.querySelectorAll('.md-codeblock pre')[1];p.scrollLeft=p.scrollWidth;return p.scrollLeft;})()");
        assert.ok(movement > 100);
        await j.shot(`code-scrolled-${size}`);
      });
      await j.clickCSS('.model-pill');
      await j.text('QA Fixture Provider');
      await measure(`search-${size}`, `(()=>{const l=__layout,w=document.querySelector('.model-sheet-search'),i=w.querySelector('input'),s=w.querySelector('svg');return {wrapper:l.rect(w),input:l.rect(i),icon:l.rect(s),background:getComputedStyle(w).backgroundColor,fieldBackground:getComputedStyle(document.querySelector('.composer-pill')).backgroundColor,hit:l.hit(i)};})()`, m => {
        assert.ok(Math.abs((m.input.top + m.input.bottom) / 2 - (m.icon.top + m.icon.bottom) / 2) <= 1, q(m));
        assert.ok(m.icon.right + 4 <= m.input.left);
        assert.ok(m.input.height >= 44 && m.hit);
        assert.equal(m.background, m.fieldBackground);
      });
      await j.shot(`search-${size}`);
      await j.type('.model-sheet-search input', 'not-a-fixture-model');
      await j.text('No models');
      await j.tap('Close');
    }
  }
  await resize(390, 844);
  await scrollAway();
  await check('jump-action-returns-to-bottom', async () => {
    await j.tap('Scroll to bottom');
    await browser.waitFor("!document.querySelector('.jump-btn') && (()=>{const e=document.querySelector('.chat-view .body');return e.scrollHeight-e.clientHeight-e.scrollTop<3})()");
    assert.equal(await browser.evaluate("(()=>{const e=document.querySelector('.chat-view .body');return e.scrollHeight-e.clientHeight-e.scrollTop<3})()"), true);
  });
  await j.tap('Back');
  await j.root('Manage');
  await j.text('Your setup.');
  for (const width of [320, 360, 390, 430]) {
    for (const height of [844, 480]) {
      const size = `${width}x${height}`;
      await resize(width, height);
      await browser.evaluate("document.querySelector('.manage').scrollIntoView({block:'start'})");
      assert.equal(await browser.evaluate("!!document.querySelector('.manage-scope')"), false, 'Hub has no irrelevant profile selector');
      await shell(`manage-root-${size}`, ['.manage-hero', '.manage-section-label', '.manage-row']);
      await j.shot(`manage-root-${size}`);
      await j.tap('Profiles', '.manage', false);
      await j.text('Profiles on this gateway');
      assert.equal(await browser.evaluate("!!document.querySelector('.manage-scope')"), false, 'Profiles uses roster identity instead of a redundant selector');
      await shell(`manage-detail-${size}`, ['.manage-page-title', '.manage-section-heading', '.manage-row']);
      await browser.evaluate("document.querySelector('.manage').scrollTop=0");
      await j.shot(`manage-detail-${size}`);
      await j.tap('Back to Manage');
      await j.tap('Capabilities', '.manage', false);
      await shell(`manage-profile-scope-${size}`, ['.manage-page-title', '.manage-scope']);
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Management profile\"]').value"), '', 'No implicit profile selection');
      await j.tap('Back to Manage');
    }
  }
  await j.root('Cronjobs');
  await j.text('QA Fixture Schedule');
  for (const width of [320, 360, 390, 430]) {
    await resize(width, 844);
    await shell(`cronjobs-${width}`, ['.manage-section-heading', '.manage-field', '.manage-detail']);
    await j.shot(`cronjobs-${width}`);
  }
  report.fixture = await browser.evaluate('({trace:__productionFixture.trace,violations:__productionFixture.violations,copied:window.__copied})');
  await check('transport-and-console-safety', () => {
    assert.deepEqual(report.fixture.violations, []);
    assert.deepEqual(browser.diagnostics, []);
    assert.deepEqual(host.rejected, []);
    const forbidden = ['prompt.submit', 'session.create', 'session.delete', 'session.steer', 'session.interrupt', 'config.set', 'profiles.configure', 'projects.set_active', 'session.workspace.move'];
    assert.ok(!report.fixture.trace.some(t => forbidden.includes(t.method)));
  });
  report.status = report.checks.every(c => c.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  report.dom = await browser.evaluate('document.body.innerText').catch(() => null);
} finally {
  report.diagnostics = browser.diagnostics;
  report.cleanup = await browser.close();
  host.server.closeAllConnections();
  await new Promise(resolve => host.server.close(resolve));
  report.serverClosed = !host.server.listening;
  if (!report.cleanup.exited || !report.cleanup.profileRemoved || !report.serverClosed) report.status = 'failed';
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failed: report.checks.filter(c => c.status === 'failed').map(c => c.name), report: path.join(output, 'report.json'), error: report.error }, null, 2));
assert.equal(report.status, 'passed');
