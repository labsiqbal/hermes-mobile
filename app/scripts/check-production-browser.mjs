#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromePipe } from './production-browser-chrome-pipe.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';

export const ROOTS = ['Home', 'Chats', 'Bots', 'Activity', 'Manage'];
export const JOURNEYS = ['login-connect', 'root-navigation', 'project-resume', 'workspace-history-draft', 'bot-profile-draft', 'groups', 'activity-runs', 'manage-sections', 'chat-controls-approval', 'transport-states', 'responsive', 'palette-focus', 'created-session-navigation', 'manage-navigation-context', 'transport-audit'];
const NAV = 'nav[aria-label="Primary"], nav.tabbar, .tabbar';
const CONTROLS = 'button, a[href], summary, input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"]';
const q = JSON.stringify;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function assertRoots(roots) { assert.deepEqual(roots, ROOTS, 'Exactly Home / Chats / Bots / Activity / Manage, in that order'); }
export function assertReceipt(report) {
  for (const id of JOURNEYS) assert.equal(report.journeys.filter(j => j.id === id && j.status === 'passed').length, 1, `Missing or failed journey: ${id}`);
  assert.equal(report.journeys.length, JOURNEYS.length, 'No duplicate/unregistered journeys');
  assert.deepEqual(report.diagnostics, [], 'Unexpected browser errors/outbound traffic');
  assert.deepEqual(report.fixture?.violations, [], 'Fixture protocol/confirmation violations');
  assert.equal(report.cleanup?.exited, true, 'Browser must exit');
  assert.equal(report.cleanup?.profileRemoved, true, 'Disposable profile must be removed');
  assert.equal(report.serverClosed, true, 'Loopback server must close');
}

export class ProductionBrowser extends ChromePipe {
  constructor(options) { super(options); this.origin = options.origin; this.assetPaths = options.assetPaths; this.requests = []; }
  allowed(url) {
    if (/^(about:|data:|blob:)/.test(url)) return true;
    try { const u = new URL(url); return u.origin === this.origin && this.assetPaths.has(u.pathname); } catch { return false; }
  }
  onEvent(event) {
    const { method, params = {}, sessionId } = event;
    if (sessionId !== this.sessionId) return;
    if (method === 'Fetch.requestPaused') {
      const allowed = this.allowed(params.request.url) && ['GET', 'HEAD'].includes(params.request.method);
      if (!allowed) this.diagnostics.push({ kind: 'blocked-outbound', url: params.request.url });
      void this.command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: params.requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }).catch(error => { if (!this.closing) this.diagnostics.push({ kind: 'interception-error', message: error.message }); });
      return;
    }
    if (method === 'Network.requestWillBeSent' || method === 'Network.webSocketCreated') {
      const url = params.request?.url || params.url;
      this.requests.push({ url, type: params.type, method: params.request?.method });
      if (method === 'Network.webSocketCreated' || !this.allowed(url)) this.diagnostics.push({ kind: 'outbound', url });
      return;
    }
    super.onEvent(event);
  }
  async open(url) {
    assert.ok(this.allowed(url), 'Entry must be owned loopback dist');
    const result = await this.command('Page.navigate', { url });
    assert.ok(!result.errorText, result.errorText);
    await this.waitFor(`location.origin === ${q(this.origin)} && document.readyState === 'complete' && !!document.querySelector('#root')`);
    await this.settle();
  }
}

export async function serveDist(appDir, selfTest = false) {
  const dist = await realpath(path.join(appDir, 'dist'));
  const index = await readFile(path.join(dist, 'index.html'));
  assert.match(index.toString(), /id=["']root["']/, 'React root required (not prototype)');
  assert.match(index.toString(), /<script[^>]+type=["']module["'][^>]+src=/, 'Built module script required');
  const { readdir } = await import('node:fs/promises');
  const files = new Map();
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(target);
      else if (entry.isFile()) {
        const resolved = await realpath(target);
        assert.ok(resolved.startsWith(dist + path.sep), 'Assets cannot escape dist');
        files.set('/' + path.relative(dist, target).split(path.sep).join('/'), await readFile(target));
      }
    }
  }
  await collect(dist);
  files.set('/', index);
  // In-memory negative canary, only reachable in --self-test; never a production result.
  if (selfTest) files.set('/__qa_canary', Buffer.from('<!doctype html><div id="root"><nav class="tabbar"><button>Home</button><button>Chats</button><button>Bots</button><button>Activity</button><button>Manage</button></nav></div>'));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  const rejected = [];
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (!['GET', 'HEAD'].includes(req.method) || !files.has(pathname)) { rejected.push({ method: req.method, path: pathname }); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(pathname)] || (pathname === '/' || pathname === '/__qa_canary' ? 'text/html' : 'application/octet-stream'), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : files.get(pathname));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, dist, assetPaths: new Set(files.keys()), rejected, hashes: [...files].filter(([name]) => name !== '/' && name !== '/__qa_canary').map(([name, bytes]) => ({ path: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })) };
}

// Only DOM queries/events and native CDP input/history are used below.
export function domHelpers() {
  window.__qaDOM = {
    visible(el) { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; },
    label(el) { return (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim(); },
    find(label, scope = 'body', exact = true) {
      return [...document.querySelectorAll(scope)].flatMap(root => [...root.querySelectorAll('button,a[href],summary,[role="button"],[role="tab"]')]).find(el => this.visible(el) && (exact ? this.label(el) === label : this.label(el).includes(label)));
    },
  };
}
export class Journeys {
  constructor(browser, report, output) { this.b = browser; this.report = report; this.output = output; }
  async run(id, fn) {
    assert.ok(JOURNEYS.includes(id));
    try { await fn(); this.report.journeys.push({ id, status: 'passed' }); }
    catch (error) {
      const failure = { id, status: 'failed', error: error.stack };
      try { failure.dom = await this.b.evaluate('({url:location.href,text:document.body.innerText,controls:[...document.querySelectorAll("button,[role=button],input,textarea")].map(el=>({label:__qaDOM.label(el),visible:__qaDOM.visible(el)}))})'); } catch { /* original error retained */ }
      this.report.journeys.push(failure);
      try { await this.shot(`FAIL-${id}`); } catch { /* browser may already have exited */ }
    }
  }
  async shot(name) { this.report.screenshots.push(await this.b.screenshot(path.join(this.output, `${name}.png`))); }
  async text(text) { await this.b.waitFor(`document.body.innerText.includes(${q(text)})`); }
  async tap(label, scope = 'body', exact = true) {
    await this.b.waitFor(`!!__qaDOM.find(${q(label)},${q(scope)},${exact})`);
    await this.b.waitFor(`(()=>{const el=__qaDOM.find(${q(label)},${q(scope)},${exact});if(!el)return false;return !document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)&&a.effect?.target?.contains(el));})()`);
    await this.b.waitFor(`(()=>{const el=__qaDOM.find(${q(label)},${q(scope)},${exact});if(!el)return false;el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(hit===el||el.contains(hit));})()`);
    const position = await this.b.evaluate(`(()=>{const el=__qaDOM.find(${q(label)},${q(scope)},${exact}); el.scrollIntoView({block:'center',inline:'nearest'}); const r=el.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2; const top=document.elementFromPoint(x,y); if(!top || !(el===top || el.contains(top))) throw new Error('Control obscured: '+${q(label)}+' '+JSON.stringify({viewport:[innerWidth,innerHeight],rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:top?.tagName,hitClass:top?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect?.target?.className}))})); return {x,y};})()`);
    await this.b.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...position, radiusX: 1, radiusY: 1 }] });
    await this.b.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.b.settle();
  }
  async clickCSS(selector) {
    await this.b.waitFor(`!!document.querySelector(${q(selector)})`);
    const pos = await this.b.evaluate(`(()=>{const e=document.querySelector(${q(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await this.b.command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pos });
    await this.b.command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pos });
    await this.b.settle();
  }
  async type(selector, value) {
    await this.b.waitFor(`!!document.querySelector(${q(selector)})`);
    await this.b.evaluate(`(()=>{const e=document.querySelector(${q(selector)}); e.focus(); e.select();})()`);
    await this.b.command('Input.insertText', { text: value });
    await this.b.settle();
    assert.equal(await this.b.evaluate(`document.querySelector(${q(selector)}).value`), value);
  }
  async root(label) {
    // Recover through real Back controls after another journey fails; never assign UI state.
    for (let n = 0; n < 4 && !(await this.b.evaluate(`!!document.querySelector(${q(NAV)})`)); n++) {
      const back = await this.b.evaluate(`['Back','Back to conversation'].find(label=>__qaDOM.find(label))`);
      if (!back) break;
      await this.tap(back);
    }
    await this.tap(label, NAV); await this.b.waitFor(`(()=>{const e=__qaDOM.find(${q(label)},${q(NAV)});return e && (e.getAttribute('aria-current')==='page'||e.getAttribute('aria-selected')==='true'||e.classList.contains('active'));})()`);
  }
  async roots() { assertRoots(await this.b.evaluate(`[...document.querySelectorAll(${q(NAV)})].filter(e=>__qaDOM.visible(e)).flatMap(n=>[...n.querySelectorAll('button,a,[role="tab"]')].map(e=>__qaDOM.label(e)))`)); }
  async back(direction = -1) {
    const history = await this.b.command('Page.getNavigationHistory');
    const target = history.entries[history.currentIndex + direction];
    assert.ok(target && target.url.startsWith(this.b.origin), 'Native history must contain an owned previous/next entry');
    await this.b.command('Page.navigateToHistoryEntry', { entryId: target.id }); await this.b.settle();
  }
  async auditLayout(name) {
    const metrics = await this.b.evaluate(`(()=>{const items=[...document.querySelectorAll(${q(CONTROLS)})].filter(el=>__qaDOM.visible(el)).map(el=>{const r=el.getBoundingClientRect();return{label:__qaDOM.label(el),x:r.x,y:r.y,w:r.width,h:r.height,disabled:!!el.disabled};}).filter(r=>r.x<innerWidth&&r.x+r.w>0&&r.y<innerHeight&&r.y+r.h>0); return{viewport:[innerWidth,innerHeight],pageWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,controls:items};})()`);
    this.report.layout.push({ name, ...metrics });
    assert.ok(metrics.pageWidth <= metrics.viewport[0] + 1 && metrics.bodyWidth <= metrics.viewport[0] + 1, `Horizontal page overflow: ${name}`);
    assert.ok(metrics.controls.length, `No reachable controls: ${name}`);
    const bad = metrics.controls.filter(r => !r.disabled && (r.w < 43.5 || r.h < 43.5 || !r.label));
    assert.deepEqual(bad, [], `Visible enabled controls need names and 44px touch targets: ${name}`);
  }
}

export async function checkNavigationRegressions(j, browser, fixture, trace) {
    await j.run('created-session-navigation', async () => {
      await j.root('Chats');
      await fixture("f.permits['session.create']=1;"); await j.tap('New chat');
      await browser.waitFor("history.state.route.conversation?.session?.id === 'qa-created-session'");
      // Truly fresh session: resume has no history, and no speculative REST 404.
      await j.type('textarea', 'QA CREATED UNSENT DRAFT');
      await j.tap('Back'); await j.back(1);
      await browser.waitFor("!!document.querySelector('.model-pill')");
      assert.equal((await trace()).filter(t=>t.route==='GET /api/sessions/qa-created-session/messages').length, 0);
      await fixture("f.emit('message.start','qa-created-session',{});f.emit('message.delta','qa-created-session',{text:'QA CREATED SETTLED REPLY'});f.emit('message.complete','qa-created-session',{text:'QA CREATED SETTLED REPLY',status:'completed'});");
      await j.text('QA CREATED SETTLED REPLY');
      assert.equal(await browser.evaluate('history.state.route.conversation.session.unpersisted'), false, 'Completion retires the fresh-only hint');
      await j.tap('Back'); await j.back(1); await j.text('QA CREATED SETTLED REPLY');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA CREATED UNSENT DRAFT');
      assert.ok((await trace()).some(t=>t.route==='GET /api/sessions/qa-created-session/messages'), 'Settled omitted resume must fetch REST history');
      for (const list of ['Home','Chats']) {
        await j.tap('Back'); await j.root(list); await j.tap('QA Created conversation','body',false);
        await j.text('QA CREATED SETTLED REPLY');
        assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA CREATED UNSENT DRAFT', list + ' canonical re-entry preserves draft');
      }
      assert.equal((await trace()).filter(t=>t.method==='session.create').length, 1, 'Identity recording never recreates the mounted conversation');
      assert.ok((await trace()).filter(t=>t.method==='session.resume'&&t.params.session_id==='qa-created-session').every(t=>t.params.omit_messages===true));
      await j.shot('created-session-restored'); await j.tap('Back');
    });
    await j.run('manage-navigation-context', async () => {
      await j.root('Manage');
      await browser.waitFor(`!!document.querySelector('select[aria-label="Management profile"] option[value="qa-bot"]')`);
      await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label="Management profile"]');e.value='qa-bot';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await j.tap('Devices & gateways','body',false); await j.tap('Back');
      assert.equal(await browser.evaluate('document.querySelector("select").value'), 'qa-bot');
      await j.tap('Profiles','body',false); await j.text('Profile description');
      await j.type('textarea[aria-label="Profile description"]', 'QA UNCONFIRMED NAVIGATION REVIEW');
      const writes = (await trace()).filter(t=>t.method==='profiles.configure').length;
      await j.tap('Review description change'); await j.text('Confirm description change');
      await j.back(); await j.back(1); await j.text('Profile description');
      assert.equal(await browser.evaluate('!!document.querySelector("dialog[open]")'), false, 'Navigation must discard a one-shot review');
      assert.notEqual(await browser.evaluate('document.querySelector("textarea").value'), 'QA UNCONFIRMED NAVIGATION REVIEW');
      assert.equal((await trace()).filter(t=>t.method==='profiles.configure').length, writes, 'Leaving review never writes');
      assert.equal(await browser.evaluate('document.querySelector("select").value'), 'qa-bot');
      await j.tap('Back to Manage');
      await j.tap('Appearance & preferences','body',false); await j.tap('Connection settings','body',false); await j.tap('Back');
      await j.text('Model and reasoning controls stay');
      assert.equal(await browser.evaluate('document.querySelector("select").value'), 'qa-bot');
      await j.back(1); await j.text('Settings'); await j.back(); await j.text('Model and reasoning controls stay');
      await j.tap('Back to Manage');
    });
}

async function checkProduction(options) {
  const report = { evidence: 'BUILT-REACT-WITH-FICTIONAL-TRANSPORT (not live-gateway proof)', appDir: options.appDir, journeys: [], screenshots: [], layout: [], diagnostics: [], limitations: ['No live gateway/authentication, prompts, mutations, native filesystem bridge, physical iOS/Android or assistive-technology proof.', 'Screenshots require independent visual review. Existing pure client/resume tests remain separate release gates.'] };
  let host, browser;
  try {
    host = await serveDist(options.appDir); report.artifact = { dist: host.dist, hashes: host.hashes };
    for (const asset of host.hashes.filter(asset=>asset.path.endsWith('.js'))) {
      const bundle = await readFile(path.join(host.dist,asset.path.slice(1)),'utf8');
      assert.ok(!bundle.includes('QA Fictional Gateway') && !bundle.includes('__productionFixture'), 'Production bundle must not contain browser test fixture data/hooks');
    }
    browser = new ProductionBrowser({ ...options, origin: host.origin, assetPaths: host.assetPaths, deadline: 240000, timeout: 5000 });
    await browser.start(); report.chrome = browser.version;
    await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProductionFixtures.toString()})(${q(FIXTURE)});(${domHelpers.toString()})();` });
    await browser.open(host.origin + '/');
    const j = new Journeys(browser, report, options.output);
    const fixture = expression => browser.evaluate(`(()=>{const f=__productionFixture;${expression}})()`);
    const trace = () => fixture('return f.trace');
    await j.run('login-connect', async () => {
      await j.tap(FIXTURE.gateway.label, 'body', false);
      await browser.waitFor(`__productionFixture.trace.some(t=>t.method==='session.list')`);
      const wire = await trace();
      assert.ok(wire.some(t => t.route === 'POST /auth/password-login'), 'Real HermesConnection password-login fallback exercised');
      assert.ok(wire.filter(t => t.route === 'POST /api/auth/ws-ticket').length >= 2, 'Ticket -> rejected -> password -> ticket chain');
      assert.ok(wire.some(t => t.event === 'constructed'), 'Real client opened fixture WebSocket');
      await j.text('QA Project conversation'); await j.shot('connected');
    });
    await j.run('root-navigation', async () => {
      await j.roots();
      for (const root of ROOTS) { await j.root(root); await j.roots(); await j.shot(`root-${root.toLowerCase()}`); }
      await j.root('Home'); await j.text(FIXTURE.gateway.label);
    });
    await j.run('project-resume', async () => {
      await j.root('Chats'); await j.tap('QA Project', 'body', false); await j.text('QA Project conversation');
      await j.tap('QA Project conversation', 'body', false);
      await j.text('QA restored answer qa-project-session');
      const wire = await trace();
      assert.ok(wire.some(t => t.method === 'projects.project_sessions' && t.params.project_id === 'qa-project'), 'Expanded project hydrated through client');
      assert.ok(wire.some(t => t.method === 'session.resume' && t.params.session_id === 'qa-project-session'));
      assert.ok(wire.some(t => t.route === 'GET /api/sessions/qa-project-session/messages'));
      await j.shot('project-resumed');
    });
    await j.run('workspace-history-draft', async () => {
      await j.type('textarea', 'QA PROJECT UNSENT DRAFT');
      const scroll = await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('div')].find(e=>getComputedStyle(e).overflowY.match(/auto|scroll/)&&e.scrollHeight>e.clientHeight+100&&e.innerText.includes('Fictional history paragraph'));if(!e)throw new Error('Long transcript must scroll');e.scrollTop=200;e.dispatchEvent(new Event('scroll'));return e.scrollTop;})()`);
      await browser.settle();
      await j.tap('Workspace', 'body', false);
      await j.text('CONVERSATION WORKSPACE'); await j.text('qa-project-session'); await j.text('default'); await j.text(new URL(FIXTURE.gateway.url).host);
      await j.shot('workspace-context');
      const buttons = await browser.evaluate(`[...document.querySelectorAll('button')].map(e=>__qaDOM.label(e))`);
      assert.ok(buttons.some(t => /Files/i.test(t)), 'Workspace files entry required');
      await j.tap('Files', 'nav[aria-label="Workspace tool"]');
      await j.tap('README.md', 'body', false); await j.text('QA fictional workspace text');
      await j.tap('Git', 'nav[aria-label="Workspace tool"]'); await j.text('fixture-branch');
      await j.tap('README.md', 'body', false); await j.text('QA after');
      await j.tap('Terminal', 'nav[aria-label="Workspace tool"]');
      await j.text('Terminal unavailable'); await j.shot('workspace-native-boundary');
      await j.tap('Preview', 'nav[aria-label="Workspace tool"]');
      await j.type('#workspace-preview-url', 'https://preview.production-qa.invalid/project/');
      const previewStart = (await trace()).length;
      await j.tap('Review preview link'); await j.text('Trust this exact preview destination?');
      await j.text('Browser host cookies may accompany navigation');
      await j.tap('Cancel preview');
      assert.equal((await trace()).length, previewStart, 'Preview review/cancel must not request anything');
      assert.equal(await browser.evaluate('!!document.querySelector("[role=alertdialog]")'), false, 'Preview cancel clears one-shot trust');
      await j.tap('Files', 'nav[aria-label="Workspace tool"]');
      await fixture("f.unsupported=['GET /api/files'];"); await j.tap('Refresh workspace');
      await j.text('unavailable'); await fixture('f.unsupported=[];');
      assert.ok(!/NOT-A-REAL-PASSWORD|fixture-user|UNSENT DRAFT/.test(await browser.evaluate('JSON.stringify(history.state)')), 'History must contain identity, never credentials or draft text');
      // Workspace internal sections may or may not add entries: Back must restore chat within a bounded chain.
      for (let n = 0; n < 4 && !(await browser.evaluate('[...document.querySelectorAll("textarea")].some(e=>__qaDOM.visible(e))')); n++) await j.back();
      await browser.waitFor('!!document.querySelector("textarea")');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA PROJECT UNSENT DRAFT');
      const restoredScroll = await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('div')].find(e=>getComputedStyle(e).overflowY.match(/auto|scroll/)&&e.scrollHeight>e.clientHeight+100&&e.innerText.includes('Fictional history paragraph'));return e?.scrollTop;})()`);
      assert.ok(Math.abs(restoredScroll - scroll) <= 2, `Transcript scroll restored: ${restoredScroll} vs ${scroll}`);
      await j.back(1); await j.text('CONVERSATION WORKSPACE'); await j.back();
      assert.equal(await browser.evaluate('document.querySelector("textarea")?.value'), 'QA PROJECT UNSENT DRAFT');
      await j.clickCSS('.model-pill'); await j.text('QA Fixture Provider');
      await fixture("f.permits['config.set']=1;"); await j.tap('fixture-alternative');
      if (await browser.evaluate('!!document.querySelector(".model-sheet")')) await j.tap('Close');
      assert.match(await browser.evaluate('document.querySelector(".model-pill").innerText'), /fixture-alternative/);
    });
    await j.run('bot-profile-draft', async () => {
      if (await browser.evaluate('!!document.querySelector("textarea")')) await j.tap('Back');
      await j.root('Bots'); await j.tap('QA Fixture Bot', 'body', false);
      await j.text('QA restored answer qa-bot-session');
      assert.notEqual(await browser.evaluate('document.querySelector("textarea").value'), 'QA PROJECT UNSENT DRAFT');
      assert.match(await browser.evaluate('document.querySelector(".model-pill").innerText'), /fixture-model/);
      await j.type('textarea', 'QA BOT UNSENT DRAFT');
      await j.tap('Workspace', 'body', false); await j.text('qa-bot'); await j.text('qa-bot-session');
      await j.back(); assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA BOT UNSENT DRAFT');
      await j.tap('Back'); await j.root('Chats');
      await j.tap('QA Project conversation', 'body', false); await j.text('QA restored answer qa-project-session');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA PROJECT UNSENT DRAFT');
      assert.match(await browser.evaluate('document.querySelector(".model-pill").innerText'), /fixture-alternative/);
      await j.tap('Back'); await j.root('Bots');
      await j.tap('QA Fixture Bot', 'body', false); await j.text('QA restored answer qa-bot-session');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA BOT UNSENT DRAFT');
      await j.back(); await j.text('QA Fixture Bot');
      await j.back(1); await j.text('QA restored answer qa-bot-session');
      assert.equal(await browser.evaluate('document.querySelector("textarea").value'), 'QA BOT UNSENT DRAFT');
      assert.match(await browser.evaluate('document.querySelector(".model-pill").innerText'), /fixture-model/);
      await j.tap('Back');
      const wire = await trace();
      assert.ok(wire.some(t => t.method === 'session.resume' && t.params.session_id === 'qa-bot-session' && t.params.profile === 'qa-bot'));
      assert.ok(wire.some(t => t.route === 'GET /api/sessions/qa-bot-session/messages' && t.query.includes('profile=qa-bot')));
      assert.ok(!wire.some(t => t.method === 'session.create'), 'Opening existing bots must never create sessions');
    });
    await j.run('groups', async () => {
      await j.root('Chats'); await j.tap('Groups', 'body', false); await j.text('QA Fixture group');
      await j.tap('QA Fixture group', 'body', false); await j.text('QA group history');
      await browser.waitFor('!!document.querySelector("textarea")'); await j.shot('group-resumed');
      await j.tap('Back'); await j.text('QA Fixture group');
      // Long-press opens existing destructive confirmation. No permit means an early mutation fails closed.
      const pos = await browser.evaluate(`(()=>{const e=__qaDOM.find('QA Fixture group','body',false);e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      const before = (await trace()).filter(t => t.method === 'profiles.configure').length;
      await browser.command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...pos });
      await j.text('Delete this group?');
      await browser.command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...pos });
      assert.equal((await trace()).filter(t => t.method === 'profiles.configure').length, before, 'No deletion before confirmation');
      await j.tap('Cancel'); await j.text('QA Fixture group');
      assert.equal((await trace()).filter(t => t.method === 'profiles.configure').length, before, 'Cancel must not mutate');
      await j.tap('Back');
    });
    await j.run('activity-runs', async () => {
      await j.root('Activity'); await j.text('QA tracked run'); await j.tap('QA tracked run', 'body', false);
      await j.text('QA fixture run output'); await j.shot('activity-run-details');
      assert.ok((await trace()).some(t => t.route === 'GET /v1/runs/qa-run/events'), 'Retained Runs SSE details');
    });
    await j.run('manage-sections', async () => {
      await j.root('Manage');
      await j.tap('Devices & gateways', 'body', false); await j.text('Settings'); await j.tap('Back');
      await j.tap('Profiles', 'body', false); await j.tap('QA Fixture Bot', '.manage', false);
      await j.text('Profile description'); await j.text('qa-bot');
      await j.type('textarea[aria-label="Profile description"]', 'QA reviewed fictional description');
      const writes = () => trace().then(rows => rows.filter(t=>t.method==='profiles.configure').length);
      const before = await writes();
      await j.tap('Review description change'); await j.text('Confirm description change');
      await j.text(FIXTURE.gateway.label); await j.text('qa-bot');
      assert.equal(await writes(), before, 'Review is not mutation');
      await j.tap('Cancel', 'dialog'); assert.equal(await writes(), before, 'Cancel is not mutation');
      await j.tap('Review description change'); await j.text('Confirm description change');
      await fixture("f.permits['profiles.configure']=1;"); await j.tap('Confirm & save description', 'dialog');
      await j.text('Description saved and verified');
      assert.equal(await writes(), before + 1, 'Exactly one explicit confirmed write');
      await j.tap('Back to Manage');
      const selectProfile = async name => {
        await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label="Management profile"]');if(![...e.options].some(o=>o.value===${q(name)}))throw Error('Missing explicit profile');e.value=${q(name)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await browser.settle();
      };
      // Fixed source-backed families, not candidate-derived coverage. Models stay in chat.
      await selectProfile('default');
      for (const [section, expected] of [['Capabilities','QA Fixture Skill'],['Memory','QA Fixture Memory'],['Schedules & cron','QA Fixture Schedule'],['Messaging','QA Fixture Messaging'],['Webhooks','No webhook request was sent'],['Kanban','QA Fixture Board'],['Appearance & preferences','Model and reasoning controls'],['Native capabilities','SSH & cloud lifecycle']]) {
        const start = (await trace()).length;
        await j.tap(section, '.manage', false); await j.text(expected);
        const route = { Memory: 'GET /api/learning/graph', Messaging: 'GET /api/messaging/platforms' }[section];
        const assertHandshake = async (since, resource) => {
          const reads = (await trace()).slice(since).filter(t=>t.transport==='fetch');
          assert.deepEqual(reads.map(t=>t.route), ['GET /api/profiles/active', resource, 'GET /api/profiles/active'], 'Ownerless reads require exact before/after current-profile checks');
          assert.deepEqual(reads.filter(t=>t.responseCurrent).map(t=>t.responseCurrent), ['default','default']);
        };
        if (route) {
          await assertHandshake(start, route);
          if (section === 'Memory') {
            const detailStart = (await trace()).length;
            await j.tap('QA Fixture Memory', '.manage', false); await j.text('QA fictional private memory detail.');
            await assertHandshake(detailStart, 'GET /api/learning/node');
          }
          if (section === 'Messaging') {
            await j.tap('QA Fixture Messaging', '.manage', false);
            assert.ok(!/QA_PRIVATE_|QA_DO_NOT_RENDER/.test(await browser.evaluate('document.body.innerText')), 'Messaging must drop private fields');
          }
          const blockedStart = (await trace()).length;
          await selectProfile('qa-bot'); await j.text('The selected profile was not queried');
          assert.deepEqual((await trace()).slice(blockedStart).filter(t=>t.transport==='fetch').map(t=>t.route), ['GET /api/profiles/active'], 'Other-profile memory/messaging blocked before content request despite sticky active matching');
          assert.ok(!(await browser.evaluate('document.querySelector(".manage").innerText')).includes(expected), 'Previous profile results must be cleared');
          await selectProfile('default'); await j.text(expected);
          await fixture("f.currentProfiles=['default','qa-bot'];");
          await j.tap(section === 'Memory' ? 'Refresh Saved memory' : 'Refresh Messaging platforms');
          await j.text('The gateway profile changed during the read');
          assert.ok(!(await browser.evaluate('document.querySelector(".manage").innerText')).includes(expected), 'Post-read ownership mismatch must discard result');
          await j.tap(section === 'Memory' ? 'Refresh Saved memory' : 'Refresh Messaging platforms'); await j.text(expected);
        }
        if (section === 'Schedules & cron') {
          assert.deepEqual((await trace()).slice(start).filter(t=>t.transport==='fetch').map(t=>t.route), ['GET /api/cron/jobs'], 'Cron uses owner echo, not running-profile/schema gate');
          await j.tap('QA Fixture Schedule', '.manage', false); await j.text('every 7d');
          await fixture("f.cronOwner='qa-bot';"); await j.tap('Refresh Scheduled jobs'); await j.text('Schedule ownership did not match');
          assert.ok(!(await browser.evaluate('document.querySelector(".manage").innerText')).includes('QA Fixture Schedule'), 'Wrong cron owner must not render');
          await fixture("f.cronOwner='default';"); await j.tap('Refresh Scheduled jobs'); await j.text(expected);
        }
        if (section === 'Kanban') { await j.tap('QA Fixture Board', '.manage', false); await j.text('QA Fixture Task'); }
        await j.shot(`manage-${section.toLowerCase().replaceAll(/[^a-z]+/g,'-')}`);
        await j.tap('Back to Manage');
      }
      // Resource loading/empty/error/unsupported are independently observable in Manage.
      assert.ok(!(await trace()).some(t=>t.route?.includes('openapi')), 'No root or guessed API schema discovery; sourced ownership checks only');
      await fixture("f.hold=['profiles.describe'];"); await j.tap('Capabilities', '.manage', false); await j.text('Loading configured capabilities');
      await fixture("f.empty=['profiles.describe'];f.release('profiles.describe');"); await j.text('None reported for this profile');
      await fixture("f.empty=[];f.errors['profiles.describe']='fixture failure';"); await j.tap('Refresh Configured capabilities'); await j.text('The management request failed');
      await fixture("delete f.errors['profiles.describe'];f.unsupported=['profiles.describe'];"); await j.tap('Refresh Configured capabilities'); await j.text('unavailable');
      await fixture('f.unsupported=[];'); await j.tap('Back to Manage');
      await j.tap('Workspace tools', '.manage', false); await j.text('Workspace unavailable');
      await j.text('explicit profile'); await j.tap('Back to conversation');
      await j.tap('Bots & routines', '.manage', false); await j.text('QA Fixture Bot');
    });
    await j.run('chat-controls-approval', async () => {
      await j.root('Home'); await j.tap('QA Project conversation', 'body', false); await j.text('QA restored answer qa-project-session');
      await j.tap('Attach'); await j.text('Image'); await j.text('File'); await j.tap('Attach');
      await j.clickCSS('.model-pill'); await j.text('QA Fixture Provider');
      await j.type('input[placeholder="Search models…"]', 'fixture-alternative'); await j.text('fixture-alternative');
      await j.tap('Close');
      await fixture("f.emit('message.start','qa-project-session',{});f.emit('message.delta','qa-project-session',{text:'QA fixture streamed reply'});");
      await j.text('QA fixture streamed reply');
      await browser.waitFor(`!!document.querySelector(${q('[aria-label="Stop active run"]')})`);
      await fixture("f.emit('message.complete','qa-project-session',{text:'QA fixture streamed reply',status:'completed'});");
      await browser.waitFor(`!document.querySelector(${q('[aria-label="Stop active run"]')})`);
      await fixture("f.approval=true;f.emit('approval.request','qa-project-session',{request_id:'qa-approval',command:'fixture-only operation (never executed)',description:'QA explicit approval',choices:['once','deny']});");
      await j.text('Approval needed');
      assert.ok(!(await trace()).some(t => t.method === 'approval.respond'), 'No automatic approval');
      await j.shot('approval-confirmation');
      await fixture("f.permits['approval.respond']=1;"); await j.tap('Deny');
      await browser.waitFor(`__productionFixture.trace.some(t=>t.method==='approval.respond'&&t.params.choice==='deny'&&t.params.request_id==='qa-approval')`);
      await j.tap('Back');
    });
    await j.run('transport-states', async () => {
      await fixture("f.hold=['profiles.list'];"); await j.root('Bots'); await j.text('Loading'); await j.shot('state-loading');
      await fixture("f.release('profiles.list');"); await j.text('QA Fixture Bot');
      await j.root('Home'); await fixture("f.errors['profiles.list']='QA fixture roster error';"); await j.root('Bots'); await j.text('QA fixture roster error'); await j.shot('state-error');
      await fixture("delete f.errors['profiles.list'];"); await j.root('Home');
      await fixture("f.unsupported=['profiles.list'];"); await j.root('Bots'); await j.text('QA fixture method not supported'); await j.shot('state-unsupported');
      await fixture("f.unsupported=[];f.empty=['profiles.list'];"); await j.root('Home'); await j.root('Bots');
      await browser.waitFor('/no profiles|no bots|empty/i.test(document.body.innerText)'); await j.shot('state-empty');
      await fixture('f.empty=[];'); await j.root('Home');
      await fixture('f.offline();');
      await browser.waitFor('/offline|disconnected|closed|reconnect|connecting/i.test(document.body.innerText) || !!document.querySelector("[title*=closed],[title*=offline],[aria-label*=closed],[aria-label*=offline]")');
      await j.shot('state-offline'); await fixture('f.online();');
      await browser.waitFor('__productionFixture.trace.filter(t=>t.event==="constructed").length>=2');
      await j.root('Bots'); await j.text('QA Fixture Bot');
    });
    await j.run('responsive', async () => {
      const failures = [];
      for (const [width, height] of [[360,844],[390,844],[430,844],[844,390]]) {
        await browser.viewport(width, height);
        for (const root of ROOTS) {
          try { await j.root(root); await j.roots(); await j.shot(`${root.toLowerCase()}-${width}x${height}`); await j.auditLayout(`${root}-${width}x${height}`); }
          catch (error) { failures.push(`${root}-${width}x${height}: ${error.message}`); }
        }
        try {
          await j.root('Home'); await j.tap('QA Project conversation','body',false); await j.text('QA restored answer qa-project-session');
          await j.shot(`chat-${width}x${height}`); await j.auditLayout(`Chat-${width}x${height}`);
          await j.tap('Workspace','body',false); await j.text('CONVERSATION WORKSPACE');
          await j.shot(`workspace-${width}x${height}`); await j.auditLayout(`Workspace-${width}x${height}`);
          await j.tap('Back to conversation'); await j.tap('Back');
        } catch (error) { failures.push(`details-${width}x${height}: ${error.message}`); }
      }
      await browser.viewport(390,844);
      assert.deepEqual(failures, [], 'Every requested viewport/root must pass');
    });
    await j.run('palette-focus', async () => {
      await browser.viewport(390,844); await j.root('Home');
      const palette = await browser.evaluate(`[...document.querySelectorAll('button')].filter(e=>__qaDOM.visible(e)).map(e=>__qaDOM.label(e)).find(n=>/command|palette|quick actions/i.test(n))`);
      if (!palette) { report.palette = 'No command palette control present; optional gate not applicable.'; return; }
      await browser.evaluate(`__qaDOM.find(${q(palette)}).focus()`);
      await browser.command('Input.dispatchKeyEvent', {type:'keyDown',key:'k',code:'KeyK',windowsVirtualKeyCode:75,modifiers:2});
      await browser.command('Input.dispatchKeyEvent', {type:'keyUp',key:'k',code:'KeyK',windowsVirtualKeyCode:75,modifiers:2});
      await browser.waitFor('!!document.querySelector("dialog[open],[role=dialog]")');
      assert.equal(await browser.evaluate('document.querySelector("dialog[open],[role=dialog]").contains(document.activeElement)'), true, 'Palette takes focus');
      for (let n = 0; n < 12; n++) {
        await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        const focus = await browser.evaluate('({inside:document.querySelector("dialog[open],[role=dialog]").contains(document.activeElement),tag:document.activeElement?.tagName,label:__qaDOM.label(document.activeElement),html:document.activeElement?.outerHTML.slice(0,300)})');
        (report.paletteFocus ||= []).push({tab:n+1,...focus});
        assert.equal(focus.inside, true, `Palette traps focus after Tab ${n+1}: ${focus.tag} ${focus.label.slice(0,80)}`);
      }
      await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await browser.waitFor('!document.querySelector("dialog[open],[role=dialog]")');
      assert.equal(await browser.evaluate('__qaDOM.label(document.activeElement)'), palette, 'Escape restores trigger focus');
    });
    await checkNavigationRegressions(j, browser, fixture, trace);
    await j.run('transport-audit', async () => {
      await browser.settle(); report.fixture = await fixture('return {trace:f.trace,violations:f.violations}');
      assert.deepEqual(report.fixture.violations, []);
      assert.equal(report.fixture.trace.filter(t=>t.method==='session.create').length, 1, 'Exactly the permitted fictional creation');
      assert.ok(!report.fixture.trace.some(t => ['prompt.submit','session.steer','session.interrupt'].includes(t.method)), 'No prompt/execution mutations');
      assert.deepEqual(browser.diagnostics, []);
      assert.deepEqual(host.rejected, []);
    });
  } catch (error) { report.fatal = error.stack; }
  finally {
    if (browser) {
      try { report.fixture ||= await browser.evaluate('({trace:__productionFixture.trace,violations:__productionFixture.violations})'); } catch { /* captured fatal retained */ }
      report.diagnostics = browser.diagnostics; report.network = browser.requests;
      try { report.cleanup = await browser.close(); } catch (error) { report.cleanupError = error.stack; }
    }
    if (host) { host.server.closeAllConnections(); await new Promise(resolve => host.server.close(resolve)); report.serverClosed = !host.server.listening; }
  }
  try { assert.ok(!report.fatal, report.fatal); assertReceipt(report); report.status = 'passed'; }
  catch (error) { report.status = 'failed'; report.gateError = error.message; }
  return report;
}

async function selfTest(options) {
  const cases = [];
  const reject = (name, fn) => { assert.throws(fn); cases.push({ name, status: 'passed' }); };
  assertRoots(ROOTS); cases.push({ name: 'positive exact-root control', status: 'passed' });
  reject('legacy roots rejected', () => assertRoots(['Board','Chats','Groups','Bots','Runs','Settings']));
  reject('missing root rejected', () => assertRoots(['Home','Chats','Bots','Manage']));
  const good = { journeys: JOURNEYS.map(id => ({ id, status: 'passed' })), diagnostics: [], fixture: { violations: [] }, cleanup: { exited: true, profileRemoved: true }, serverClosed: true };
  assertReceipt(good);
  for (const id of JOURNEYS) reject(`missing journey rejected: ${id}`, () => assertReceipt({ ...good, journeys: good.journeys.filter(j => j.id !== id) }));
  reject('console error rejected', () => assertReceipt({ ...good, diagnostics: [{ kind: 'console-error' }] }));
  reject('early mutation rejected', () => assertReceipt({ ...good, fixture: { violations: ['mutation before confirmation'] } }));
  reject('profile leak rejected', () => assertReceipt({ ...good, cleanup: { exited: true, profileRemoved: false } }));
  let host, browser, cleanup, serverClosed = false;
  try {
    host = await serveDist(options.appDir, true);
    browser = new ProductionBrowser({ ...options, origin: host.origin, assetPaths: host.assetPaths }); await browser.start();
    await browser.open(host.origin + '/__qa_canary');
    assertRoots(await browser.evaluate('[...document.querySelectorAll("nav button")].map(e=>e.textContent)'));
    await browser.evaluate('document.querySelector("nav button").textContent="WRONG ROOT"');
    const wrong = await browser.evaluate('[...document.querySelectorAll("nav button")].map(e=>e.textContent)');
    reject('actual browser DOM wrong root rejected', () => assertRoots(wrong));
    await browser.evaluate('console.error("QA deliberate negative canary");void fetch("https://outbound.production-qa.invalid/never").catch(()=>{});');
    await browser.waitFor('document.readyState === "complete"'); await sleep(150);
    assert.ok(browser.diagnostics.some(d => d.kind === 'console-error'));
    assert.ok(browser.diagnostics.some(d => d.kind === 'blocked-outbound'));
    cases.push({ name: 'actual Chrome console error and blocked outbound captured', status: 'passed' });
    await browser.evaluate(`(${installProductionFixtures.toString()})(${q(FIXTURE)})`);
    const fixtureCanary = await browser.evaluate(`(async()=>{
      const f=__productionFixture;
      const ticket=await fetch(${q(FIXTURE.gateway.url + '/api/auth/ws-ticket')},{method:'POST'});
      const login=await fetch(${q(FIXTURE.gateway.url + '/auth/password-login')},{method:'POST',body:JSON.stringify({provider:'basic',username:'fixture-user',password:'NOT-A-REAL-PASSWORD'})});
      const schema=await fetch(${q(FIXTURE.gateway.url + '/openapi.json')});
      const file=await fetch(${q(FIXTURE.gateway.url + '/api/files/read?path=/fictional/qa-project/README.md&profile=default')});
      const fileData=await file.json();
      const socket=new WebSocket(${q(FIXTURE.gateway.url.replace('https:','wss:') + '/api/ws?ticket=FICTIONAL-ONE-USE-TICKET')});
      await new Promise(resolve=>socket.addEventListener('message',resolve,{once:true}));
      const response=new Promise(resolve=>socket.addEventListener('message',event=>resolve(JSON.parse(event.data)),{once:true}));
      socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'profiles.configure',params:{name:'qa-bot',description:'unconfirmed'}}));
      const mutation=await response;
      let rpcId=1;
      const rpc=(method,params)=>new Promise(resolve=>{
        socket.addEventListener('message',event=>resolve(JSON.parse(event.data)),{once:true});
        socket.send(JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}));
      });
      const omitted=await rpc('session.resume',{session_id:'qa-recent-session',omit_messages:true});
      const included=await rpc('session.resume',{session_id:'qa-recent-session',omit_messages:false});
      const deniedCreate=await rpc('session.create',{});
      f.permits['session.create']=1;
      const created=await rpc('session.create',{});
      const fresh=await fetch(${q(FIXTURE.gateway.url + '/api/sessions/qa-created-session/messages')});
      const identity=await (await fetch(${q(FIXTURE.gateway.url + '/api/profiles/active')})).json();
      const managementInit={method:'GET',credentials:'include',redirect:'error',cache:'no-store'};
      const memory=await (await fetch(${q(FIXTURE.gateway.url + '/api/learning/graph?profile=default')},managementInit)).json();
      const denied=[];
      for(const route of ['/api/openapi.json','/api/learning/graph?profile=qa-bot','/api/learning/graph?profile=default&extra=1']) {
        try { await fetch(${q(FIXTURE.gateway.url)}+route,managementInit); } catch { denied.push(route); }
      }
      return {ticket:ticket.status,login:login.status,schema:schema.status,fileData,mutation,omitted,included,deniedCreate,created,freshStatus:fresh.status,identity,memory,denied,violations:f.violations};
    })()`);
    assert.equal(fixtureCanary.ticket,401); assert.equal(fixtureCanary.login,200); assert.equal(fixtureCanary.schema,404);
    assert.equal(Buffer.from(fixtureCanary.fileData.data_url.split(',')[1],'base64').toString(),'QA fictional workspace text');
    assert.deepEqual(fixtureCanary.identity,{current:'default',active:'qa-bot'});
    assert.equal(fixtureCanary.memory.nodes[0].id,'memory:memory:0');
    assert.deepEqual(fixtureCanary.denied,['/api/openapi.json','/api/learning/graph?profile=qa-bot','/api/learning/graph?profile=default&extra=1']);
    cases.push({name:'exact final management contracts accept current-profile read and reject guessed schema/wrong scope/extra query',status:'passed'});
    assert.deepEqual(fixtureCanary.omitted.result.messages, []);
    assert.equal(fixtureCanary.included.result.messages.length, 2);
    assert.ok(fixtureCanary.deniedCreate.error);
    assert.equal(fixtureCanary.created.result.session_id,'qa-created-session');
    assert.equal(fixtureCanary.freshStatus,404);
    cases.push({name:'resume honors exact omit_messages; create requires permit; truly fresh REST is 404',status:'passed'});
    assert.ok(fixtureCanary.mutation.error);
    assert.ok(fixtureCanary.violations.some(v=>v.includes('without harness confirmation permit')));
    cases.push({name:'actual injected transport rejects immediate mutation and serves explicit auth/file contracts',status:'passed'});
  } finally {
    if (browser) cleanup = await browser.close();
    if (host) { host.server.closeAllConnections(); await new Promise(resolve => host.server.close(resolve)); serverClosed = !host.server.listening; }
  }
  assert.ok(cleanup?.exited && cleanup.profileRemoved && serverClosed);
  return { status: 'passed', evidence: 'HARNESS NEGATIVE CANARIES ONLY — not production app evidence', cases, cleanup, serverClosed };
}

async function main() {
  const args = process.argv.slice(2), options = { appDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output: path.resolve('production-browser-evidence'), chrome: '/usr/bin/google-chrome' };
  for (let n = 0; n < args.length; n++) {
    const arg = args[n];
    if (arg === '--self-test') options.selfTest = true;
    else if (['--app-dir','--output','--chrome'].includes(arg)) { assert.ok(args[n+1] && !args[n+1].startsWith('--'), `Missing value for ${arg}`); options[arg === '--app-dir' ? 'appDir' : arg.slice(2)] = path.resolve(args[++n]); }
    else throw new Error(`Unknown option: ${arg}`);
  }
  await access(path.join(options.appDir, 'dist', 'index.html'));
  assert.ok(!options.output.startsWith(path.join(options.appDir,'dist') + path.sep) && options.output !== path.join(options.appDir,'dist'), 'Reports must not alter built dist');
  await mkdir(options.output, { recursive: true });
  let report;
  try { report = options.selfTest ? await selfTest(options) : await checkProduction(options); }
  catch (error) { report = { status: 'failed', fatal: error.stack }; }
  const name = options.selfTest ? 'self-test' : 'report';
  await writeFile(path.join(options.output, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(options.output, `${name}.md`), `# Production browser ${name}\n\nStatus: **${report.status}**\n\n${report.evidence || ''}\n\n` + (report.journeys || report.cases || []).map(c=>`- ${c.status}: ${c.id || c.name}${c.error ? ` — ${c.error.split('\n')[0]}` : ''}`).join('\n') + '\n\nFull trace, hashes, screenshots, layout metrics and cleanup in JSON. Fixture evidence is not live-gateway parity proof.\n');
  console.log(JSON.stringify({ status: report.status, report: path.join(options.output, `${name}.json`), failures: report.journeys?.filter(j=>j.status !== 'passed').map(({id,error})=>({id,error})), cases: report.cases?.length, cleanup: report.cleanup, serverClosed: report.serverClosed, fatal: report.fatal }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
