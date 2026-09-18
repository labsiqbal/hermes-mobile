#!/usr/bin/env node
// Built App + native browser cookie jar. Auth HTTP is fulfilled below fetch;
// all remaining gateway traffic is fictional. This is not live-gateway proof.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] || '/tmp/hm-auth-browser');
await mkdir(output, { recursive: true });
const host = await serveDist(app);
const fixture = { ...FIXTURE, gateway: { ...FIXTURE.gateway, url: host.origin } };
const q = JSON.stringify;
const cookieValue = 'FICTIONAL-HTTPONLY-SESSION';
class AuthBrowser extends ProductionBrowser {
  mode = 200;
  auth = [];
  expectedErrors = [];
  allowed(url) {
    try {
      const u = new URL(url);
      if (u.origin === this.origin && ['/auth/password-login', '/api/auth/ws-ticket'].includes(u.pathname)) return true;
    } catch { /* handled by base policy */ }
    return super.allowed(url);
  }
  onEvent(event) {
    if (event.sessionId === this.sessionId && event.method === 'Fetch.requestPaused') {
      const { request, requestId } = event.params;
      const u = new URL(request.url);
      if (u.origin === this.origin && ['/auth/password-login', '/api/auth/ws-ticket'].includes(u.pathname)) {
        let status = 200, body = {}, headers = [{ name: 'Content-Type', value: 'application/json' }];
        assert.equal(request.method, 'POST');
        const cookie = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'cookie')?.[1] || '';
        if (u.pathname === '/auth/password-login') {
          const credentials = JSON.parse(request.postData);
          assert.equal(credentials.provider, 'basic');
          assert.equal(credentials.username, fixture.gateway.username);
          if (credentials.password !== fixture.gateway.password) status = 401;
          else headers.push({ name: 'Set-Cookie', value: `qa_auth=${cookieValue}; HttpOnly; SameSite=Strict; Path=/` });
        } else if (this.mode !== 200) status = this.mode;
        else if (!cookie.includes(`qa_auth=${cookieValue}`)) status = 401;
        else body = { ticket: 'FICTIONAL-ONE-USE-TICKET' };
        this.auth.push({ path: u.pathname, status, cookieSent: cookie.includes(cookieValue) });
        void this.command('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(JSON.stringify(body)).toString('base64') })
          .catch(error => this.diagnostics.push({ kind: 'auth-fixture', message: error.message }));
        return;
      }
    }
    if (event.sessionId === this.sessionId && event.method === 'Log.entryAdded') {
      const entry = event.params.entry;
      if (entry.source === 'network' && ['/auth/password-login', '/api/auth/ws-ticket'].some(route => entry.url === this.origin + route)
        && /\b(401|403|503)\b/.test(entry.text)) { this.expectedErrors.push(entry); return; }
    }
    super.onEvent(event);
  }
}
const browser = new AuthBrowser({ origin: host.origin, assetPaths: host.assetPaths, output, timeout: 8000, deadline: 150000, chrome: process.env.CHROME_BIN || '/usr/bin/google-chrome' });
const report = { evidence: 'BUILT-APP-NATIVE-AUTH-HTTP-FIXTURES-NOT-LIVE', checks: [], screenshots: [], layout: [] };
const j = new Journeys(browser, report, output);
const check = async (name, fn) => { await fn(); report.checks.push(name); };
const passwordSelector = 'input[type=password]';
const connected = () => browser.waitFor(`document.body.innerText.includes('Connected')`);
const signIn = async (password = fixture.gateway.password) => {
  await j.type(passwordSelector, password);
  await j.tap(`Sign in to ${fixture.gateway.label}`);
};
const reload = async () => { await browser.command('Page.reload'); await browser.settle(); };
const storage = () => browser.evaluate(`(async()=>({local:{...localStorage},session:{...sessionStorage},databases:await indexedDB.databases(),cookie:document.cookie,history:history.state}))()`);
async function assertNoSecrets() {
  const state = await storage();
  for (const secret of [fixture.gateway.password, cookieValue, 'FICTIONAL-ONE-USE-TICKET', 'LEGACY-SECRET', 'LEGACY-TOKEN', 'WRONG-PASSWORD']) {
    assert.ok(!JSON.stringify(state).includes(secret), 'Credential leaked into JS-readable persistence: ' + secret);
  }
  assert.deepEqual(state.databases, [], 'No auth IndexedDB database');
  assert.deepEqual(state.session, {}, 'No sessionStorage auth state');
  const saved = JSON.parse(state.local['hermes-mobile.connections.v1']);
  assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(saved[0]).sort(), ['id', 'label', 'url', 'username']);
  assert.equal(saved[0].url, host.origin);
  assert.equal(saved[0].username, fixture.gateway.username);
  return saved;
}
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument', { source: `
    const previous = {...localStorage};
    const nativeFetch = window.fetch.bind(window);
    (${installProductionFixtures.toString()})(${q(fixture)});
    localStorage.clear();
    for (const [key,value] of Object.entries(previous)) localStorage.setItem(key,value);
    const fixtureFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input==='string'?input:input.url, location.href);
      if (['/auth/password-login','/api/auth/ws-ticket'].includes(url.pathname)) {
        const response = await nativeFetch(input,init);
        if(url.pathname==='/api/auth/ws-ticket') __productionFixture.authenticated=response.ok;
        return response;
      }
      return fixtureFetch(input,init);
    };
    (${domHelpers.toString()})();
  ` });
  await browser.open(host.origin + '/');
  await check('Save remembers metadata without accepting or persisting a password', async () => {
    await j.type('[aria-label="Device label"]', fixture.gateway.label);
    await j.type('[aria-label="Gateway URL"]', host.origin);
    await j.type('[aria-label="Gateway username"]', fixture.gateway.username);
    assert.equal(await browser.evaluate('document.querySelectorAll("input[type=password]").length'), 0);
    await j.tap('Test'); await j.text('OK - Hermes fixture-only');
    assert.equal(browser.auth.length, 0, 'Reachability test must not attempt authentication');
    await j.tap('Save');
    await assertNoSecrets();
    await reload();
    await j.text(fixture.gateway.label);
    await assertNoSecrets();
  });
  await check('Missing cookie prompts sign-in; wrong password stays retryable and clears the field', async () => {
    await j.tap(fixture.gateway.label, 'body', false);
    await browser.waitFor(`!!document.querySelector(${q(passwordSelector)})`);
    assert.equal(browser.auth.filter(r => r.path === '/auth/password-login').length, 0);
    await signIn('WRONG-PASSWORD');
    await j.text('login failed: HTTP 401');
    assert.equal(await browser.evaluate(`document.querySelector(${q(passwordSelector)}).value`), '');
    await assertNoSecrets();
    await signIn(); await connected(); await assertNoSecrets();
    const cookies = (await browser.command('Network.getCookies', { urls: [host.origin] })).cookies;
    const cookie = cookies.find(c => c.name === 'qa_auth');
    assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Strict');
    assert.ok(browser.auth.some(r => r.path === '/api/auth/ws-ticket' && r.status === 200 && r.cookieSent));
  });
  await check('Valid cookie restores the intended conversation without a password POST', async () => {
    await j.tap('QA Project conversation');
    await j.text('QA restored answer qa-project-session');
    const before = browser.auth.filter(r => r.path === '/auth/password-login').length;
    await reload(); await j.text('QA restored answer qa-project-session');
    assert.equal(browser.auth.filter(r => r.path === '/auth/password-login').length, before);
    assert.equal(await browser.evaluate('history.state.route.conversation.id'), 'qa-project-session');
    await assertNoSecrets();
  });
  for (const status of [401, 403]) {
    await check(`${status} reload preserves destination through sign-in`, async () => {
      browser.mode = status === 401 ? 200 : status;
      if (status === 401) await browser.command('Network.deleteCookies', { name: 'qa_auth', url: host.origin });
      await reload(); await j.text('Your session expired. Sign in to continue.');
      assert.equal(await browser.evaluate('history.state.route.conversation.id'), 'qa-project-session');
      for (const width of [320, 390, 1000]) {
        await browser.viewport(width, 844);
        await j.auditLayout(`auth-${status}-${width}`);
        assert.ok(await browser.evaluate(`document.querySelector('.connection-row .rowcard-title').getBoundingClientRect().width >= 90`), 'Device title must remain readable next to status and remove controls');
        await j.shot(`auth-${status}-${width}`);
      }
      await browser.viewport(390, 844);
      browser.mode = 200;
      await signIn(); await j.text('QA restored answer qa-project-session');
      await assertNoSecrets();
    });
    await check(`${status} socket reconnect prompts instead of reusing the entered password`, async () => {
      const before = browser.auth.filter(r => r.path === '/auth/password-login').length;
      browser.mode = status;
      await browser.evaluate('__productionFixture.offline(); __productionFixture.online();');
      await j.text('Your session expired. Sign in to continue.');
      assert.equal(browser.auth.filter(r => r.path === '/auth/password-login').length, before);
      browser.mode = 200;
      await signIn(); await j.text('QA restored answer qa-project-session');
      await assertNoSecrets();
    });
  }
  await check('503 restore offers retry, not password; 503 reconnect retries automatically', async () => {
    browser.mode = 503; await reload(); await j.text('Retry connection');
    assert.equal(await browser.evaluate('document.querySelectorAll("input[type=password]").length'), 0);
    browser.mode = 200; await j.tap('Retry connection'); await j.text('QA restored answer qa-project-session');
    browser.mode = 503;
    const start = browser.auth.length;
    await browser.evaluate('__productionFixture.offline(); __productionFixture.online();');
    const deadline = Date.now() + 8000;
    while (!browser.auth.slice(start).some(r => r.status === 503) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(browser.auth.slice(start).some(r => r.status === 503), 'Reconnect must attempt a new ticket');
    browser.mode = 200; await connected();
    assert.equal(await browser.evaluate('history.state.route.conversation.id'), 'qa-project-session');
    await assertNoSecrets();
  });
  await check('Legacy migration removes passwords and tokens without losing metadata or unrelated storage', async () => {
    const saved = await assertNoSecrets();
    await browser.evaluate(`localStorage.setItem('unrelated-app','keep'); localStorage.setItem('hermes-mobile.connections.v1',${q(JSON.stringify([{ ...saved[0], password: 'LEGACY-SECRET', token: 'LEGACY-TOKEN' }]))});`);
    await reload(); await j.text('QA restored answer qa-project-session');
    assert.deepEqual(await assertNoSecrets(), saved);
    assert.equal(await browser.evaluate('localStorage.getItem("unrelated-app")'), 'keep');
  });
  const trace = await browser.evaluate('__productionFixture.trace');
  assert.ok(!trace.some(t => ['session.create', 'prompt.submit'].includes(t.method)));
  assert.deepEqual(await browser.evaluate('__productionFixture.violations'), []);
  assert.deepEqual(browser.diagnostics, []);
  assert.deepEqual(host.rejected, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack;
  try { report.dom = await browser.evaluate('document.body.innerText'); await j.shot('FAIL-auth'); } catch { /* retain first failure */ }
} finally {
  report.auth = browser.auth; report.diagnostics = browser.diagnostics;
  report.expectedErrors = browser.expectedErrors;
  report.cleanup = await browser.close();
  host.server.closeAllConnections(); await new Promise(resolve => host.server.close(resolve));
  await writeFile(path.join(output, 'auth-report.json'), JSON.stringify(report, null, 2));
}
assert.equal(report.status, 'passed', report.error);
assert.ok(report.cleanup.exited && report.cleanup.profileRemoved);
console.log(`Auth browser: PASS (${report.checks.length} checks). Evidence: ${output}`);
