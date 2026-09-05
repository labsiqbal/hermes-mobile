// Focused transport copy of parity-review/check-prototype.mjs ChromePipe.
// No prototype runner/import side effects; production policy is a subclass.
// Chrome transport only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-proxy-server', 'about:blank',
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
