#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowedURL = url => /^(file:|data:|blob:|about:)/i.test(url);

/** Minimal reusable CDP transport: Chrome fd3 receives NUL-delimited JSON; fd4 sends it.
 * Always use try/finally { await browser.close(); }, including when start() rejects.
 * No shell, TCP listener, browser dependency or persistent browser profile is used.
 */
export class ChromePipe {
  constructor({ chrome = '/usr/bin/google-chrome', output, timeout = 8000, deadline = 240000 }) {
    this.options = { chrome, output, timeout, deadline };
    this.sequence = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.events = [];
    this.diagnostics = [];
    this.stderr = '';
    this.cleanup = { exited: false, profileRemoved: false };
  }

  async start() {
    this.profile = await mkdtemp(path.join(this.options.output, '.chrome-profile-'));
    this.child = spawn(this.options.chrome, [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--disable-default-apps',
      '--disable-extensions', '--disable-domain-reliability', '--disable-breakpad',
      '--metrics-recording-only', '--safebrowsing-disable-auto-update',
      '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--no-proxy-server', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: true });
    this.exited = new Promise(resolve => {
      this.child.once('exit', (code, signal) => {
        this.cleanup.exited = true;
        this.cleanup.exitCode = code;
        this.cleanup.signal = signal;
        this.rejectPending(new Error(`Chrome exited (${code ?? signal}): ${this.stderr}`));
        resolve();
      });
      this.child.once('error', error => {
        this.cleanup.exited = true;
        this.rejectPending(error);
        resolve();
      });
    });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-12000); });
    this.child.stdio[3].on('error', error => this.rejectPending(error));
    this.child.stdio[4].on('error', error => this.rejectPending(error));
    this.child.stdio[4].on('end', () => this.rejectPending(new Error('Chrome CDP pipe ended')));
    this.child.stdio[4].on('data', chunk => this.receive(chunk));
    this.onSignal = signal => {
      this.aborted = new Error(`Interrupted by ${signal}`);
      this.rejectPending(this.aborted);
      void this.close().catch(error => console.error(error.message));
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
    };
    this.sigint = () => this.onSignal('SIGINT');
    this.sigterm = () => this.onSignal('SIGTERM');
    process.once('SIGINT', this.sigint);
    process.once('SIGTERM', this.sigterm);
    this.onExit = () => this.killGroup('SIGKILL');
    process.once('exit', this.onExit);
    this.watchdog = setTimeout(() => {
      this.aborted = new Error(`Overall browser deadline exceeded (${this.options.deadline}ms)`);
      this.rejectPending(this.aborted);
      void this.close().catch(error => console.error(error.message));
    }, this.options.deadline);
    this.version = await this.send('Browser.getVersion');
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    this.targetId = targetId;
    this.sessionId = (await this.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map(method => this.command(method)));
    await this.command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.command('Page.setDownloadBehavior', { behavior: 'deny' });
    await this.viewport(390, 844);
    return this;
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 64 * 1024 * 1024) {
      this.rejectPending(new Error('CDP frame exceeds 64MiB limit'));
      this.killGroup('SIGKILL');
      return;
    }
    let boundary;
    while ((boundary = this.buffer.indexOf(0)) !== -1) {
      const frame = this.buffer.subarray(0, boundary).toString('utf8');
      this.buffer = this.buffer.subarray(boundary + 1);
      if (!frame) continue;
      let message;
      try { message = JSON.parse(frame); }
      catch (error) { this.rejectPending(new Error(`Invalid CDP JSON: ${error.message}`)); continue; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else this.onEvent(message);
    }
  }

  onEvent({ method, params = {}, sessionId }) {
    if (sessionId !== this.sessionId) return;
    const add = (kind, detail) => this.diagnostics.push({ kind, ...detail });
    if (method === 'Runtime.exceptionThrown') add('exception', { detail: params.exceptionDetails });
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      add('console-error', { args: params.args.map(arg => arg.value ?? arg.description) });
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') add('browser-error', { detail: params.entry });
    if (method === 'Network.requestWillBeSent' || method === 'Network.webSocketCreated') {
      const url = params.request?.url ?? params.url;
      if (url && !allowedURL(url)) add('outbound', { url, method });
    }
    if (method === 'Network.loadingFailed' && !params.canceled) add('load-failed', { detail: params });
    if (method === 'Fetch.requestPaused') {
      const local = allowedURL(params.request.url);
      if (!local) add('blocked-outbound', { url: params.request.url });
      void this.command(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }),
      }).catch(error => { if (!this.closing) add('interception-error', { message: error.message }); });
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, sessionId, timeout = this.options.timeout) {
    if (this.aborted) return Promise.reject(this.aborted);
    if (this.closing || !this.child || this.cleanup.exited) return Promise.reject(new Error('Chrome is not running'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0', error => {
        if (error && this.pending.has(id)) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  command(method, params = {}, timeout) { return this.send(method, params, this.sessionId, timeout); }

  async evaluate(expression, timeout) {
    const response = await this.command('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    }, timeout);
    if (response.exceptionDetails) throw new Error(`Evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    return response.result.value;
  }

  async waitFor(expression, timeout = this.options.timeout) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await this.evaluate(expression, Math.max(1, until - Date.now()))) return;
      await delay(40);
    }
    throw new Error(`Condition timed out: ${expression.slice(0, 240)}`);
  }

  async open(url) {
    if (!url.startsWith('file:')) throw new Error('Only file:// entry points are allowed');
    const navigation = await this.command('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    // A hashless entry may initialize its default route. Never relax an explicit
    // fragment (including an empty '#'), or the requested document path/query.
    const actualURL = url.includes('#') ? 'location.href' : "location.href.split('#')[0]";
    const loaded = `${actualURL} === ${JSON.stringify(url)} && document.readyState === 'complete' && !!document.body`;
    await this.waitFor(loaded);
    await this.settle();
    // A script may redirect after the initial ready-state observation.
    await this.waitFor(loaded);
  }

  async settle() {
    await this.evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    await delay(60);
  }

  async viewport(width, height = 844) {
    await this.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await this.command('Emulation.setTouchEmulationEnabled', { enabled: true });
  }

  async screenshot(filename) {
    const { data } = await this.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buffer = Buffer.from(data, 'base64');
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
    await writeFile(filename, buffer);
    return { file: filename, bytes: buffer.length, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  killGroup(signal) {
    if (!this.child?.pid) return;
    try { process.kill(-this.child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      clearTimeout(this.watchdog);
      this.rejectPending(new Error('Chrome closing'));
      try {
        if (this.child) {
          this.killGroup('SIGTERM');
          await Promise.race([this.exited, delay(1200)]);
          // Kill the owned process group even if the browser leader exited first.
          this.killGroup('SIGKILL');
          await Promise.race([this.exited, delay(2000)]);
          if (!this.cleanup.exited) throw new Error('Chrome did not exit after SIGKILL');
          this.child.stdio[3]?.destroy();
          this.child.stdio[4]?.destroy();
          this.child.stderr?.destroy();
        } else this.cleanup.exited = true;
      } finally {
        if (this.profile) {
          await rm(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          this.cleanup.profileRemoved = true;
          this.cleanup.profile = this.profile;
        }
        if (this.sigint) process.removeListener('SIGINT', this.sigint);
        if (this.sigterm) process.removeListener('SIGTERM', this.sigterm);
        if (this.onExit) process.removeListener('exit', this.onExit);
      }
      return this.cleanup;
    })();
    return this.closePromise;
  }
}

const DEFAULT_SELECTORS = {
  main: 'main, [role="main"], #content, #app',
  bottomNav: '[data-bottom-nav], .bottom-nav, .tabbar, nav[aria-label="Primary"]',
  nativeWarning: '[data-native-warning], .native-warning, [role="alert"]',
  composer: '[data-qa="composer"], textarea',
  transcript: '[data-qa="transcript"], .transcript, .messages',
  files: '[data-qa="open-files"], [data-route="files"], a[href="#files"]',
  preview: '[data-qa="open-preview"], [data-route="preview"], a[href="#preview"]',
  back: '[data-qa="back"], [data-action="back"], button[aria-label="Back"]',
  botChat: '[data-qa="bot-chat"]',
  approve: '[data-qa="approve"]',
  approvalConfirm: '[data-qa="confirm-approval"], [data-qa="approval-confirm"]',
  approvalResult: '[data-qa="approval-result"], [role="status"]',
  offlineToggle: '[data-qa="offline-toggle"], [data-qa="state-select"]',
  send: '[data-qa="send"], button[type="submit"], button[aria-label="Send"]',
  modalTrigger: '[data-qa="context-switcher"]',
  dialog: 'dialog[open], [role="dialog"][aria-modal="true"]',
};

// Runs in the browser, deliberately includes small text links and off-screen
// rendered controls. display:none, hidden ancestors and opacity:0 are excluded.
function inspectDOM(selectors) {
  const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  const describe = element => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(), id: element.id || undefined,
      label: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('title') || '').trim().slice(0, 180),
      href: element.getAttribute('href') || undefined,
      width: +rect.width.toFixed(2), height: +rect.height.toFixed(2),
      x: +rect.x.toFixed(2), y: +rect.y.toFixed(2),
    };
  };
  const elements = [...document.body.querySelectorAll('*')].filter(visible);
  const content = [...document.querySelectorAll(selectors.main)].find(visible);
  const text = (content?.innerText ?? '').trim();
  const targets = elements.filter(element => element.matches('a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])'));
  const scroll = document.scrollingElement;
  const nativeElements = [...document.querySelectorAll(selectors.nativeWarning)].filter(visible);
  return {
    url: location.href, hash: location.hash, title: document.title, readyState: document.readyState,
    viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth },
    contentFound: !!content, text, textLength: text.length,
    headings: elements.filter(element => /^H[1-6]$/.test(element.tagName)).map(describe),
    mockLabel: /\b(mock|sample|prototype)\b/i.test(document.body.innerText),
    bottomNav: [...document.querySelectorAll(selectors.bottomNav)].filter(visible).map(describe),
    nativeWarningText: nativeElements.map(element => element.innerText).join('\n'),
    pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, scroll?.scrollWidth ?? 0) - document.documentElement.clientWidth,
    overflowingElements: elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
    }).map(describe),
    scrollContainers: elements.filter(element => element.scrollWidth > element.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)).map(describe),
    targetCount: targets.length,
    smallTargets: targets.map(describe).filter(target => target.width < 43.99 || target.height < 43.99),
    unlabeledTargets: targets.filter(element => !((element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('title') || '').trim()) && !element.labels?.length).map(describe),
  };
}

async function inspect(browser, selectors) {
  return browser.evaluate(`(${inspectDOM.toString()})(${JSON.stringify(selectors)})`);
}

function record(report, scope, name, passed, detail) {
  report.checks.push({ scope, name, status: passed ? 'passed' : 'failed', ...(detail === undefined ? {} : { detail }) });
}

async function routeTo(browser, route) {
  await browser.evaluate(`location.hash = ${JSON.stringify('#' + route)}`);
  await browser.waitFor(`location.hash === ${JSON.stringify('#' + route)}`);
  await browser.settle();
}

export async function click(browser, selector) {
  const point = await browser.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
    if (!element) throw new Error('No visible click target: ' + ${JSON.stringify(selector)});
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('Click target is disabled');
    element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = document.elementFromPoint(x,y);
    if (!top || !(element === top || element.contains(top))) throw new Error('Click target is obscured');
    return {x,y};
  })()`);
  await browser.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await browser.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await browser.settle();
}

async function key(browser, name, modifiers = 0) {
  const codes = { Escape: 27, Tab: 9, Backspace: 8, a: 65 };
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers });
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers });
}

async function valueOf(browser, selector) {
  return browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value`);
}

async function assertRoute(browser, route) {
  await browser.waitFor(`location.hash === ${JSON.stringify('#' + route)}`);
}

async function visibleExists(browser, selector) {
  return browser.evaluate(`!![...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))`);
}

async function switchOffline(browser, selector) {
  // Native select widgets use their public input/change events, not app state hooks.
  // Buttons are exercised with CDP pointer events through click().
  const selected = await browser.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
    if (!(element instanceof HTMLSelectElement)) return false;
    if (element.disabled) throw new Error('State selector is disabled');
    const option = [...element.options].find(o => !o.disabled && /offline|disconnected/i.test(o.value + ' ' + o.textContent));
    if (!option) throw new Error('State select has no offline option');
    element.focus();
    element.value = option.value;
    element.dispatchEvent(new Event('input', {bubbles:true}));
    element.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  })()`);
  if (!selected) await click(browser, selector);
  await browser.settle();
}

async function runFlows(browser, report, variant, selectors, entry) {
  const run = async (name, route, work) => {
    const start = browser.diagnostics.length;
    const scope = `${variant.id}/flow/${name}`;
    try {
      await browser.open(entry + '#' + route);
      await work();
      record(report, scope, 'click journey', true);
    } catch (error) {
      record(report, scope, 'click journey', false, error.message);
    }
    record(report, scope, 'no browser errors or outbound attempts', browser.diagnostics.length === start, browser.diagnostics.slice(start));
  };
  await browser.viewport(390);
  await run('chat-draft-preview-back', 'chat', async () => {
    const draft = 'QA unsent draft — preserve on return';
    await click(browser, selectors.composer);
    await key(browser, 'a', 2);
    await browser.command('Input.insertText', { text: draft });
    assert.equal(await valueOf(browser, selectors.composer), draft);
    const scroll = await browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selectors.transcript)});
      if (!el) throw new Error('Transcript selector requires alignment');
      el.scrollTop = Math.min(120, el.scrollHeight - el.clientHeight);
      return {top:el.scrollTop, maximum:el.scrollHeight-el.clientHeight};
    })()`);
    await click(browser, selectors.files);
    await assertRoute(browser, 'files');
    await click(browser, selectors.preview);
    await assertRoute(browser, 'preview');
    await click(browser, selectors.back);
    await assertRoute(browser, 'files');
    await click(browser, selectors.back);
    await assertRoute(browser, 'chat');
    assert.equal(await valueOf(browser, selectors.composer), draft, 'draft survives preview and Back');
    const restored = await browser.evaluate(`document.querySelector(${JSON.stringify(selectors.transcript)})?.scrollTop`);
    assert.ok(Math.abs(restored - scroll.top) <= 1, 'transcript scroll survives preview and Back');
    if (scroll.maximum <= 0) report.limitations.push(`${variant.id}: transcript fixture does not scroll; nonzero scroll restoration untested`);
  });
  await run('bots-chat-back', 'bots', async () => {
    await click(browser, selectors.botChat);
    await assertRoute(browser, 'chat');
    await click(browser, selectors.back);
    await assertRoute(browser, 'bots');
  });
  await run('approval', 'approval', async () => {
    const before = await browser.evaluate(`document.body.innerText`);
    assert.match(before, /gateway/i, 'approval names gateway scope');
    assert.match(before, /profile/i, 'approval names profile scope');
    await click(browser, selectors.approve);
    if (await visibleExists(browser, selectors.dialog)) {
      const confirmation = await browser.evaluate(`document.querySelector(${JSON.stringify(selectors.dialog)}).innerText`);
      assert.match(confirmation, /gateway/i, 'confirmation retains gateway scope');
      assert.match(confirmation, /profile/i, 'confirmation retains profile scope');
      assert.equal(await visibleExists(browser, selectors.approvalConfirm), true, 'confirmation dialog needs an explicit confirm control');
      await click(browser, selectors.approvalConfirm);
      assert.equal(await visibleExists(browser, selectors.dialog), false, 'confirmation closes after decision');
    } else if (await visibleExists(browser, selectors.approvalConfirm)) {
      await click(browser, selectors.approvalConfirm);
    } else {
      assert.fail('Approval requires an explicit second confirmation');
    }
    const after = await browser.evaluate(`document.querySelector(${JSON.stringify(selectors.approvalResult)})?.innerText ?? ''`);
    assert.match(after, /approved|resolved|allowed|accepted/i, 'visible resolved approval outcome');
    assert.notEqual(await browser.evaluate('document.body.innerText'), before);
  });
  await run('offline-disables-send', 'chat', async () => {
    await click(browser, selectors.composer);
    await browser.command('Input.insertText', { text: 'Do not send offline' });
    const enabled = await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selectors.send)}); return !!e && !e.disabled && e.getAttribute('aria-disabled') !== 'true'; })()`);
    assert.equal(enabled, true, 'send initially enabled with draft');
    await switchOffline(browser, selectors.offlineToggle);
    const disabled = await browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selectors.send)}); return !!e && (e.disabled || e.getAttribute('aria-disabled') === 'true'); })()`);
    assert.equal(disabled, true, 'send disabled in offline prototype state');
    assert.match(await browser.evaluate('document.body.innerText'), /offline|disconnected/i);
  });
  await run('modal-escape-focus', 'home', async () => {
    await click(browser, selectors.modalTrigger);
    const inside = `(() => {const d=document.querySelector(${JSON.stringify(selectors.dialog)}); return !!d && d.contains(document.activeElement);})()`;
    assert.equal(await browser.evaluate(inside), true, 'focus moves into modal');
    const count = await browser.evaluate(`document.querySelector(${JSON.stringify(selectors.dialog)}).querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])').length`);
    assert.ok(count > 0 && count < 100, 'bounded modal tab cycle');
    for (let i = 0; i <= count; i++) {
      await key(browser, 'Tab');
      assert.equal(await browser.evaluate(inside), true, `forward focus trapped at Tab ${i}`);
    }
    await key(browser, 'Tab', 8);
    assert.equal(await browser.evaluate(inside), true, 'reverse focus trapped');
    await key(browser, 'Escape');
    await browser.settle();
    assert.equal(await browser.evaluate(`!![...document.querySelectorAll(${JSON.stringify(selectors.dialog)})].find(e=>e.checkVisibility())`), false, 'Escape closes modal');
    assert.equal(await browser.evaluate(`document.activeElement.matches(${JSON.stringify(selectors.modalTrigger)})`), true, 'focus restored to opener');
  });
}

const REQUIRED_ROUTES = 'home,chats,chat,bots,bot,groups,group,activity,approval,schedules,schedule,manage,gateways,profiles,capabilities,memory,messaging,webhooks,kanban,command-center,files,preview,artifacts,git,terminal,browser,settings,voice,native'.split(',');

async function readManifest(root) {
  let filename;
  for (const candidate of ['design/parity-routes.json', 'parity-routes.json']) {
    try { await access(path.join(root, candidate)); filename = path.join(root, candidate); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!filename) throw new Error('Missing design/parity-routes.json (or parity-routes.json). Prototype QA NOT RUN. --self-test only verifies the harness.');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(manifest.schema_version, 1, 'manifest schema_version');
  assert.ok(Array.isArray(manifest.routes) && Array.isArray(manifest.variants), 'manifest routes and variants arrays');
  const ids = new Set();
  for (const route of manifest.routes) {
    assert.match(route.id, /^[a-z][a-z0-9-]*$/, 'route id must be a literal hash slug');
    assert.ok(typeof route.title === 'string' && route.title.trim() && typeof route.kind === 'string' && route.kind.trim(), `route ${route.id} title/kind required`);
    assert.ok(!ids.has(route.id), `duplicate route ${route.id}`);
    ids.add(route.id);
  }
  for (const route of REQUIRED_ROUTES) assert.ok(ids.has(route), `missing required route ${route}`);
  assert.deepEqual(manifest.variants.map(v => v.id).sort(), ['shell', 'workspace'], 'both navigation variants required');
  for (const variant of manifest.variants) {
    assert.ok(typeof variant.entry === 'string' && !path.isAbsolute(variant.entry), 'variant entry must be repository relative');
    const resolved = path.resolve(root, variant.entry);
    assert.ok(resolved.startsWith(root + path.sep), 'variant entry must stay in repository');
    assert.ok(ids.has(variant.root), 'variant root must exist');
    await access(resolved);
  }
  return { manifest, filename };
}

export async function checkPrototype(options) {
  const report = {
    schema_version: 1, status: 'running', root: options.root, started: new Date().toISOString(),
    checks: [], cases: [], screenshots: [], diagnostics: [],
    limitations: ['Headless Chromium is not real iOS Safari or Android device signoff.', 'No contrast, screen reader, 200% text scale, real keyboard, landscape, or background/reconnect signoff.', 'Prototype interactions prove sample UI only, never gateway/runtime parity.', 'Network observation is limited to the attached page; not an OS-level egress sandbox.'],
  };
  const browser = new ChromePipe(options);
  try {
    const { manifest, filename } = await readManifest(options.root);
    report.manifest = filename;
    const overrides = options.selectors ? JSON.parse(await readFile(options.selectors, 'utf8')) : {};
    for (const group of Object.values(overrides)) {
      assert.ok(group && typeof group === 'object' && !Array.isArray(group), 'selector groups must be objects');
      for (const [name, value] of Object.entries(group)) assert.ok(name in DEFAULT_SELECTORS && typeof value === 'string' && value.length > 0, `unknown or invalid selector ${name}`);
    }
    await browser.start();
    report.browser = browser.version;
    for (const variant of manifest.variants) {
      const selectors = { ...DEFAULT_SELECTORS, ...overrides.common, ...overrides[variant.id] };
      const entry = pathToFileURL(path.resolve(options.root, variant.entry)).href;
      for (const width of [390, 360, 430, 320]) {
        const routes = width === 390 || width === 320 ? manifest.routes : manifest.routes.filter(r => ['home', 'chat', 'manage'].includes(r.id));
        await browser.viewport(width);
        await browser.open(entry + '#' + variant.root);
        let previous = null;
        const contents = new Map();
        for (const route of routes) {
          const scope = `${variant.id}/${route.id}/${width}x844`;
          const diagnosticStart = browser.diagnostics.length;
          const row = { scope, variant: variant.id, route: route.id, width, height: 844 };
          report.cases.push(row);
          try {
            await routeTo(browser, route.id);
            const dom = await inspect(browser, selectors);
            row.dom = dom;
            record(report, scope, 'loaded intended hash route', dom.readyState === 'complete' && dom.hash === '#' + route.id);
            record(report, scope, 'correct CSS viewport', dom.viewport.width === width, dom.viewport);
            record(report, scope, 'nonblank main content and heading', dom.contentFound && dom.textLength >= 20 && dom.headings.length > 0);
            record(report, scope, 'obvious mock/sample label', dom.mockLabel);
            if (previous && previous.route !== route.id) record(report, scope, 'route changes rendered content', previous.text !== dom.text, { previousRoute: previous.route });
            if (contents.has(dom.text)) record(report, scope, 'route is not an identical fallback', false, { identicalTo: contents.get(dom.text) });
            contents.set(dom.text, route.id);
            previous = { route: route.id, text: dom.text };
            record(report, scope, 'no page horizontal overflow', dom.pageOverflow <= 1, { overflow: dom.pageOverflow });
            record(report, scope, '44px touch targets including links', dom.smallTargets.length === 0, dom.smallTargets);
            record(report, scope, 'controls have discoverable names', dom.unlabeledTargets.length === 0, dom.unlabeledTargets);
            if (route.id === 'home') record(report, scope, 'distinct navigation architecture', variant.id === 'shell' ? dom.bottomNav.length > 0 : dom.bottomNav.length === 0, dom.bottomNav);
            if (variant.id === 'workspace') record(report, scope, 'workspace has no persistent bottom nav', dom.bottomNav.length === 0, dom.bottomNav);
            if (route.id === 'native') {
              const warning = dom.nativeWarningText || dom.text;
              record(report, scope, 'native blocker visibly explained', /native|desktop|bridge/i.test(warning) && /blocked|not available|unavailable|unsupported|requires|not implemented|cannot|not supported/i.test(warning), warning);
            }
            if (width === 390 && ['home', 'chat', 'manage'].includes(route.id)) report.screenshots.push(await browser.screenshot(path.join(options.output, `${variant.id}-${route.id}-${width}x844.png`)));
          } catch (error) { record(report, scope, 'route execution', false, error.stack); }
          record(report, scope, 'no browser errors or outbound attempts', browser.diagnostics.length === diagnosticStart, browser.diagnostics.slice(diagnosticStart));
          if (browser.aborted || browser.cleanup.exited) throw browser.aborted ?? new Error('Browser exited during route checks');
        }
      }
      await runFlows(browser, report, variant, selectors, entry);
    }
    const hub = path.join(options.root, 'design/parity-compare/index.html');
    await access(hub);
    await browser.viewport(1440, 1000);
    await browser.open(pathToFileURL(hub).href);
    const hubDOM = await inspect(browser, DEFAULT_SELECTORS);
    report.cases.push({ scope: 'compare/1440x1000', dom: hubDOM });
    record(report, 'compare/1440x1000', 'hub loads nonblank with heading', hubDOM.textLength >= 20 && hubDOM.headings.length > 0);
    record(report, 'compare/1440x1000', 'no page horizontal overflow', hubDOM.pageOverflow <= 1, hubDOM.pageOverflow);
    record(report, 'compare/1440x1000', '44px touch targets including links', hubDOM.smallTargets.length === 0, hubDOM.smallTargets);
    const hubLinks = await browser.evaluate(`Array.from(document.querySelectorAll('a[href]'), a => a.href)`);
    for (const variant of manifest.variants) record(report, 'compare/1440x1000', `hub links to ${variant.id}`, hubLinks.some(href => href.split('#')[0] === pathToFileURL(path.resolve(options.root, variant.entry)).href));
    report.screenshots.push(await browser.screenshot(path.join(options.output, 'compare-1440x1000.png')));
  } catch (error) { record(report, 'runner', 'complete requested run', false, error.stack); }
  finally {
    try { report.cleanup = await browser.close(); }
    catch (error) { record(report, 'runner', 'cleanup', false, error.stack); }
    report.chromeStderr = browser.stderr;
    report.diagnostics = browser.diagnostics;
  }
  record(report, 'runner', 'no browser errors or outbound attempts anywhere', report.diagnostics.length === 0, report.diagnostics);
  report.finished = new Date().toISOString();
  report.summary = { cases: report.cases.length, checks: report.checks.length, failed: report.checks.filter(check => check.status === 'failed').length, screenshots: report.screenshots.length };
  report.status = report.summary.failed ? 'failed' : 'passed';
  return report;
}

async function selfTest(options) {
  const fixture = await mkdtemp(path.join(options.output, '.fixture-'));
  const browser = new ChromePipe(options);
  let result;
  try {
    await writeFile(path.join(fixture, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pipe fixture</title>
      <main><h1>Pipe self-test</h1><button style="width:80px;height:48px">Ready</button>
      <a href="#small" style="display:inline-block;width:10px;height:10px">Small link</a>
      <span hidden><a href="#hidden">Hidden link</a></span>
      <select id="fixture-state" aria-label="Sample state" onchange="document.querySelector('#fixture-send').disabled = this.value === 'offline'"><option value="connected">Connected</option><option value="offline">Offline</option></select>
      <button id="fixture-send">Send</button><button id="fixture-approve" onclick="document.querySelector('#fixture-confirm').showModal()">Approve</button>
      <dialog id="fixture-confirm"><p>Gateway fixture · profile fixture</p><button id="fixture-confirm-button" onclick="document.querySelector('#fixture-result').textContent='Approved';this.closest('dialog').close()">Confirm</button></dialog><p id="fixture-result">Pending</p></main>`);
    await browser.start();
    await browser.open(pathToFileURL(path.join(fixture, 'index.html')).href);
    assert.equal(await browser.evaluate('21 * 2'), 42);
    assert.equal(await browser.evaluate('document.querySelector("h1").textContent'), 'Pipe self-test');
    const dom = await inspect(browser, DEFAULT_SELECTORS);
    assert.ok(dom.smallTargets.some(target => target.label === 'Small link'), 'small visible links are findings');
    assert.ok(!dom.smallTargets.some(target => target.label === 'Hidden link'), 'hidden links are excluded');
    assert.equal(await browser.evaluate('document.querySelector("#fixture-send").disabled'), false);
    await switchOffline(browser, '#fixture-state');
    assert.equal(await browser.evaluate('document.querySelector("#fixture-send").disabled'), true, 'native offline select invokes UI handler');
    await click(browser, '#fixture-approve');
    assert.equal(await visibleExists(browser, '#fixture-confirm'), true, 'approval opens confirmation');
    assert.equal(await browser.evaluate('document.querySelector("#fixture-result").textContent'), 'Pending', 'opening confirmation does not approve');
    await click(browser, '#fixture-confirm-button');
    assert.equal(await visibleExists(browser, '#fixture-confirm'), false, 'explicit confirmation closes dialog');
    assert.equal(await browser.evaluate('document.querySelector("#fixture-result").textContent'), 'Approved');
    const png = await browser.screenshot(path.join(options.output, 'self-test.png'));
    assert.ok(png.bytes > 100);
    assert.equal(png.width, 390);
    assert.equal(png.height, 844);
    // Match the compare hub's default-fragment navigation without weakening deep links.
    const navigationFixture = pathToFileURL(path.join(fixture, 'navigation.html')).href;
    await writeFile(path.join(fixture, 'navigation.html'), `<!doctype html><title>Navigation fixture</title><main>Sample navigation fixture</main>
      <script>const target = new URLSearchParams(location.search).get('target');
      if (target) location.replace(target);
      else if (!location.hash) history.replaceState(null, '', '#shell');</script>`);
    await browser.open(navigationFixture + '?case=default');
    assert.equal(await browser.evaluate('location.href'), navigationFixture + '?case=default#shell', 'hashless entry accepts only a default fragment on the same path/query');
    await browser.open(navigationFixture + '?case=explicit#workspace');
    assert.equal(await browser.evaluate('location.href'), navigationFixture + '?case=explicit#workspace', 'explicit deep link remains exact');
    const navigationTimeout = browser.options.timeout;
    try {
      browser.options.timeout = 800;
      await assert.rejects(browser.open(navigationFixture + '?target=%23shell#workspace'), /timed out/, 'wrong explicit hash must fail');
      await assert.rejects(browser.open(navigationFixture + '#'), /timed out/, 'explicit empty hash must not accept a default fragment');
      await assert.rejects(browser.open(navigationFixture + '?target=%3Fchanged%3D1%23shell'), /timed out/, 'hashless entry must reject a changed query');
      await assert.rejects(browser.open(navigationFixture + '?target=index.html%23shell'), /timed out/, 'hashless entry must reject a changed path');
    } finally { browser.options.timeout = navigationTimeout; }
    await assert.rejects(browser.evaluate('new Promise(() => {})', 100), /timed out/);
    assert.equal(await browser.evaluate('6 * 7'), 42, 'pipe recovers after timeout');
    await assert.rejects(browser.waitFor('false', 100), /timed out/);
    await assert.rejects(browser.command('NotARealDomain.notAMethod'), /wasn.t found/);
    await browser.evaluate(`setTimeout(() => { throw new Error('intentional-self-test-exception'); }, 0); true`);
    await delay(100);
    assert.ok(browser.diagnostics.some(d => d.kind === 'exception'), 'uncaught browser exception recorded');
    await browser.evaluate(`fetch('https://fixture.invalid/intentional-block').catch(() => {}); true`);
    for (let i = 0; i < 20 && !browser.diagnostics.some(d => d.kind === 'blocked-outbound'); i++) await delay(50);
    assert.ok(browser.diagnostics.some(d => d.kind === 'blocked-outbound'), 'outbound request intercepted and reported');
    assert.equal(browser.pending.size, 0, 'no pending CDP calls');
    result = {
      status: 'passed', type: 'harness-self-test-not-prototype-evidence',
      checks: ['pipe handshake', 'Runtime.evaluate', 'local file navigation', 'hashless entry accepts default fragment with exact path/query', 'explicit deep link preserved', 'wrong explicit or empty fragment and changed path/query reject', 'PNG screenshot', 'small visible links reported; hidden links excluded', 'bounded command and condition timeouts', 'pipe usable after timeout', 'CDP errors reject', 'uncaught exceptions recorded', 'outbound request blocked and recorded'],
      screenshot: png, expectedDiagnostics: browser.diagnostics,
    };
  } finally {
    try { await browser.close(); }
    finally { await rm(fixture, { recursive: true, force: true }); }
  }
  assert.equal(browser.cleanup.exited, true);
  assert.equal(browser.cleanup.profileRemoved, true);
  await assert.rejects(access(browser.profile));
  await assert.rejects(access(fixture));
  assert.throws(() => process.kill(browser.child.pid, 0), { code: 'ESRCH' });
  result.checks.push('Chrome PID gone', 'temporary profile and fixture removed');
  result.cleanup = browser.cleanup;

  // Exercise the complete runner against synthetic HTML, NOT prototype evidence.
  // All route/layout gates pass; absent controls and immediate approval MUST fail.
  const integration = await mkdtemp(path.join(options.output, '.runner-fixture-'));
  const output = path.join(options.output, 'fixture-integration');
  await mkdir(output, { recursive: true });
  try {
    const manifest = {
      schema_version: 1,
      routes: REQUIRED_ROUTES.map(id => ({ id, title: id, kind: 'fixture' })),
      variants: ['shell', 'workspace'].map(id => ({ id, entry: `design/parity-${id}/index.html`, root: 'home' })),
    };
    await mkdir(path.join(integration, 'design/parity-compare'), { recursive: true });
    await writeFile(path.join(integration, 'design/parity-routes.json'), JSON.stringify(manifest));
    for (const variant of manifest.variants) {
      await mkdir(path.dirname(path.join(integration, variant.entry)), { recursive: true });
      await writeFile(path.join(integration, variant.entry), `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Runner fixture ${variant.id}</title>
        <main></main>${variant.id === 'shell' ? '<nav data-bottom-nav>Shell fixture navigation</nav>' : ''}
        <script>function render(){const id=location.hash.slice(1)||'home';document.querySelector('main').innerHTML='<h1>'+id+'</h1><p>Sample prototype fixture gateway profile content. Native requires bridge; unavailable.</p>';
          if(id==='approval'){const button=document.createElement('button');button.dataset.qa='approve';button.textContent='Approve immediately';button.style.cssText='min-width:44px;min-height:44px';const result=document.createElement('p');result.dataset.qa='approval-result';result.textContent='Pending';button.onclick=()=>{result.textContent='Approved immediately';};document.querySelector('main').append(button,result);}
        }addEventListener('hashchange',render);render();</script>`);
    }
    await writeFile(path.join(integration, 'design/parity-compare/index.html'), '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Compare fixture</title><style>a{display:block;min-height:44px}</style><main><h1>Sample comparison fixture</h1><a href="../parity-shell/index.html">Shell fixture</a><a href="../parity-workspace/index.html">Workspace fixture</a></main>');
    const fixtureReport = await checkPrototype({ ...options, root: integration, output, selectors: undefined });
    fixtureReport.type = 'synthetic-harness-fixture-not-prototype-evidence';
    await writeFile(path.join(output, 'fixture-report.json'), JSON.stringify(fixtureReport, null, 2) + '\n');
    assert.equal(fixtureReport.cases.length, REQUIRED_ROUTES.length * 4 + 13, 'every planned route/viewport and hub exercised');
    assert.equal(fixtureReport.screenshots.length, 7, 'both variants home/chat/manage plus hub captured');
    assert.equal(fixtureReport.diagnostics.length, 0, 'clean fixture emits no browser errors');
    const failures = fixtureReport.checks.filter(check => check.status === 'failed');
    assert.equal(fixtureReport.status, 'failed', 'missing flows may not silently pass');
    assert.equal(failures.length, 10, 'four absent flows and immediate approval per variant must fail');
    for (const variant of manifest.variants) {
      assert.match(failures.find(check => check.scope === `${variant.id}/flow/approval`)?.detail ?? '', /explicit second confirmation/, 'immediate approval cannot pass the real journey');
    }
    assert.ok(failures.every(check => check.name === 'click journey'), JSON.stringify(failures));
    result.integration = { report: path.join(output, 'fixture-report.json'), summary: fixtureReport.summary, expectedFailures: failures.map(check => check.scope) };
    manifest.routes.push(manifest.routes[0]);
    await writeFile(path.join(integration, 'design/parity-routes.json'), JSON.stringify(manifest));
    await assert.rejects(readManifest(integration), /duplicate route/);
    manifest.routes.pop();
    manifest.routes[0].id = 'Bad Route';
    await writeFile(path.join(integration, 'design/parity-routes.json'), JSON.stringify(manifest));
    await assert.rejects(readManifest(integration), /literal hash slug/);
    result.checks.push('complete route/viewport/screenshot runner exercised on synthetic fixture', 'missing click journeys and immediate approval without explicit second confirmation fail instead of skip', 'duplicate and malformed manifest route IDs rejected');
  } finally { await rm(integration, { recursive: true, force: true }); }
  await assert.rejects(access(integration));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node app/scripts/check-prototype.mjs --root /absolute/repo --output /absolute/evidence [--chrome /path/to/chrome] [--self-test] [--selectors /absolute/selectors.json]');
    return;
  }
  const options = { chrome: '/usr/bin/google-chrome', selfTest: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--self-test') options.selfTest = true;
    else if (['--root', '--output', '--chrome', '--selectors'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  for (const name of ['root', 'output']) {
    if (!options[name] || !path.isAbsolute(options[name])) throw new Error(`--${name} must be absolute`);
  }
  if (options.selectors && !path.isAbsolute(options.selectors)) throw new Error('--selectors must be absolute');
  await mkdir(options.output, { recursive: true });
  let report;
  try {
    report = options.selfTest ? await selfTest(options) : await checkPrototype(options);
  } catch (error) {
    report = { status: 'failed', fatal: error.stack };
  }
  const reportFile = path.join(options.output, options.selfTest ? 'self-test.json' : 'report.json');
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  if (!options.selfTest) {
    const failures = (report.checks ?? []).filter(check => check.status === 'failed');
    const lines = [
      '# Prototype QA receipt', '', `Status: **${report.status.toUpperCase()}**`, '',
      `Root: \`${options.root}\``, `Full evidence: [report.json](report.json)`, '',
      '## Counts', '', '```json', JSON.stringify(report.summary ?? {}, null, 2), '```', '',
      '## Failures (none suppressed)', '',
      ...(failures.length ? failures.map(check => `- **${check.scope}** — ${check.name}; details in report.json`) : ['- None recorded.']),
      ...(report.fatal ? ['```', report.fatal, '```'] : []), '',
      '## Screenshots', '', ...(report.screenshots ?? []).map(image => `- [${path.basename(image.file)}](${path.basename(image.file)}) — ${image.width}×${image.height}`), '',
      '## Limits / remaining manual signoff', '', ...(report.limitations ?? []).map(item => `- ${item}`), '',
      'Screenshots are captured evidence, not an automated visual or accessibility approval.', '',
    ];
    await writeFile(path.join(options.output, 'report.md'), lines.join('\n'));
  }
  console.log(JSON.stringify({
    status: report.status, report: reportFile,
    ...(report.summary ? { summary: report.summary } : {}),
    ...(options.selfTest ? { checks: report.checks, integration: report.integration } : { failures: (report.checks ?? []).filter(check => check.status === 'failed').map(({scope, name, detail}) => ({scope, name, detail})) }),
    cleanup: report.cleanup, ...(report.fatal ? { fatal: report.fatal } : {}),
  }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
