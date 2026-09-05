#!/usr/bin/env node
// Deterministic public-boundary tests. No live gateway, credentials or mutations.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'workspace-check-'));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
try {
  const outfile = join(temp, 'workspace.mjs');
  buildSync({ entryPoints: [join(here, '../src/lib/workspace-client.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { workspaceContext, WorkspaceClient, safeWorkspacePath, safePreviewUrl, WORKSPACE_LIMITS } = await import(pathToFileURL(outfile).href);
  const conn = { id: 'gateway-a', url: 'https://gateway.example', label: 'A', username: '', password: '' };
  const client = { url: conn.url, connectionState: 'open' };
  const session = { id: 's1', profile: 'builder', cwd: '/work/project', git_repo_root: '/work/project' };
  await test('context binds exact gateway/profile/session/cwd and rejects missing ownership', () => {
    const context = workspaceContext(conn, client, session);
    assert.equal(context.profile, 'builder');
    assert.equal(context.cwd, '/work/project');
    assert.equal(context.sessionId, 's1');
    assert.throws(() => workspaceContext(conn, client, null));
    assert.throws(() => workspaceContext(conn, client, { ...session, profile: undefined }));
    assert.throws(() => workspaceContext(conn, { ...client, url: 'https://other.example' }, session));
  });
  const entry = (name, extra = {}) => ({ name, path: `/work/project/${name}`, is_directory: false, size: 5, ...extra });
  const listing = (entries, path = '/work/project') => ({ path, entries, root: null, locked_root: null, can_change_path: true });
  const calls = [];
  let answer = listing([entry('README.md'), entry('.env'), entry('alias.md', { path: '/outside/secret.md' }), entry('src', { is_directory: true, size: null })]);
  const fetcher = async (url, options) => { calls.push({ url: String(url), options }); return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } }); };
  const api = new WorkspaceClient(conn, client, session, { fetch: fetcher });
  await test('one scoped directory request; secret names and resolved symlink escapes never render', async () => {
    const result = await api.list('/work/project');
    assert.deepEqual(result.entries.map(e => e.name), ['README.md', 'src']);
    assert.equal(result.omitted, true);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin, conn.url); assert.equal(url.pathname, '/api/files');
    assert.equal(url.searchParams.get('path'), '/work/project'); assert.equal(url.searchParams.get('profile'), 'builder');
    assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.cache, 'no-store');
  });
  await test('traversal, credential material, and out-of-workspace paths never request', async () => {
    for (const path of ['/work/project/../x', '/work/project/%2e%2e/x', '/work/project/.env.example', '/work/project/auth.json', '/work/project/id_rsa', '/work/project/a.pem', '/work/project/key-store.json', '/work/project/.ssh/id_ed25519', '/work/project/config.yaml', '/work/project/a\\b', '/work/project/*', '/', 'file:///work/project/a']) {
      assert.equal(safeWorkspacePath(path), false, path);
      const before = calls.length; await assert.rejects(api.list(path)); assert.equal(calls.length, before);
    }
    await assert.rejects(api.list('/work/project-other'));
  });
  await test('selected safe file is revalidated and read with the guarded managed route', async () => {
    const readCalls = [];
    const textApi = new WorkspaceClient(conn, client, session, { fetch: async (url, options) => {
      readCalls.push({ url: new URL(url), options });
      const data = String(url).includes('/api/files/read?') ? { path: '/work/project/README.md', name: 'README.md', size: 5, mime_type: 'text/markdown', data_url: 'data:text/markdown;base64,aGVsbG8=' } : listing([entry('README.md')]);
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    } });
    const text = await textApi.readText('/work/project/README.md');
    assert.equal(text.text, 'hello'); assert.equal(text.truncated, false);
    assert.deepEqual(readCalls.map(c => c.url.pathname), ['/api/files', '/api/files/read']);
    assert.equal(readCalls[1].url.searchParams.get('path'), '/work/project/README.md');
  });
  const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  const makeApi = fetch => new WorkspaceClient(conn, client, session, { fetch });
  await test('explicit .worktrees cwd retains bounded Files and Git with protected descendants denied', async () => {
    const cwd = '/home/iqbal/workspace/.worktrees/hermes-mobile/feature';
    assert.equal(safeWorkspacePath(cwd), true);
    const requested = [];
    const worktree = new WorkspaceClient(conn, client, { ...session, cwd, git_repo_root: cwd }, { fetch: async url => {
      const u = new URL(url); requested.push(u);
      if (u.pathname === '/api/git/status') return response({ branch: 'feature', detached: false, changed: 0, files: [] });
      if (u.pathname === '/api/git/file-diff') return response({ diff: '-old\n+new' });
      if (u.pathname === '/api/files/read') return response({ path: cwd + '/README.md', size: 5, data_url: 'data:text/plain;base64,aGVsbG8=' });
      return response({ path: cwd, entries: [{ name: 'README.md', path: cwd + '/README.md', is_directory: false, size: 5 }, { name: '.git', path: cwd + '/.git', is_directory: false, size: 20 }] });
    } });
    assert.equal(worktree.context.cwd, cwd);
    assert.deepEqual((await worktree.list(cwd)).entries.map(row => row.name), ['README.md']);
    assert.equal((await worktree.readText(cwd + '/README.md')).text, 'hello');
    assert.equal((await worktree.gitStatus()).branch, 'feature');
    assert.equal((await worktree.diff(cwd + '/README.md')).text, '-old\n+new');
    assert.ok(requested.every(u => u.searchParams.get('path') === cwd || u.searchParams.get('path') === cwd + '/README.md'));
    const before = requested.length;
    for (const path of [cwd + '/.env', cwd + '/.ssh/id_rsa', cwd + '/.git/config', cwd + '/auth.json', cwd + '/../other', cwd + '/%2e%2e/other', '/home/iqbal/workspace/.worktrees', '/home/iqbal/.other/project']) {
      assert.equal(safeWorkspacePath(path), false, path);
      await assert.rejects(worktree.readText(path));
    }
    await assert.rejects(worktree.list('/home/iqbal/workspace/.worktrees/hermes-mobile/sibling'));
    assert.equal(requested.length, before);
    const alias = new WorkspaceClient(conn, client, { ...session, cwd }, { fetch: async () => response({ path: '/elsewhere', entries: [] }) });
    await assert.rejects(alias.list(cwd), /exact workspace/);
  });
  await test('Git status and one-file diff use exact verified routes, repo, relative filename and profile', async () => {
    const requested = [];
    const gitApi = makeApi(async url => {
      const u = new URL(url); requested.push(u);
      if (u.pathname === '/api/git/status') return response({ branch: 'main', detached: false, changed: 2, files: [{ path: 'README.md', staged: true, unstaged: false, untracked: false, conflicted: false }, { path: '.env', staged: true, unstaged: false, untracked: false, conflicted: false }] });
      if (u.pathname === '/api/git/file-diff') return response({ diff: '-old\n+new' });
      return response(listing([entry('README.md')]));
    });
    const status = await gitApi.gitStatus();
    assert.equal(status.branch, 'main'); assert.deepEqual(status.files.map(f => f.path), ['/work/project/README.md']); assert.equal(status.omitted, true);
    assert.equal((await gitApi.diff('/work/project/README.md')).text, '-old\n+new');
    const diff = requested.at(-1); assert.equal(diff.pathname, '/api/git/file-diff'); assert.equal(diff.searchParams.get('file'), 'README.md'); assert.equal(diff.searchParams.get('path'), '/work/project');
    assert.ok(requested.every(u => u.searchParams.get('profile') === 'builder'));
  });
  await test('nested cwd never broadens Git to sibling directories', async () => {
    const nested = new WorkspaceClient(conn, client, { ...session, cwd: '/work/project/src' }, { fetch: () => { throw Error('unexpected request'); } });
    await assert.rejects(nested.gitStatus(), /repository root exactly/);
    await assert.rejects(nested.diff('/work/project/README.md'));
  });
  await test('null status and empty listing remain distinct from failures', async () => {
    assert.equal((await makeApi(async () => response(listing([]))).list('/work/project')).entries.length, 0);
    assert.equal(await makeApi(async url => response(String(url).includes('/api/git/') ? null : listing([]))).gitStatus(), null);
    await assert.rejects(makeApi(async () => response({ entries: [], error: 'denied' })).list('/work/project'));
  });
  await test('status/authorization errors are safe and never retry or leak server body', async () => {
    for (const status of [401, 403, 404, 413, 429, 500]) {
      let n = 0;
      const failing = makeApi(async () => { n++; return new Response('sensitive server traceback', { status }); });
      await assert.rejects(failing.list('/work/project'), error => error.code === `http-${status}` && !error.message.includes('sensitive server traceback'));
      assert.equal(n, 1);
    }
  });
  await test('offline and mismatched client never request; profile/session/gateway changes isolate keys', async () => {
    const offline = new WorkspaceClient(conn, { ...client, connectionState: 'closed' }, session, { fetch: () => { throw Error('unexpected request'); } });
    await assert.rejects(offline.list('/work/project'), /offline/);
    const key = workspaceContext(conn, client, session).key;
    for (const changed of [{ ...session, profile: 'studio' }, { ...session, id: 's2' }, { ...session, resolved_id: 'next' }, { ...session, cwd: '/work/project/src' }]) assert.notEqual(workspaceContext(conn, client, changed).key, key);
    assert.notEqual(workspaceContext({ ...conn, id: 'gateway-b' }, client, session).key, key);
  });
  await test('file size, binary, alias and protected selections block before any content request', async () => {
    for (const file of [entry('README.md', { size: WORKSPACE_LIMITS.fileBytes + 1 }), entry('README.md', { path: '/work/project/auth.json' }), entry('README.md', { is_directory: true })]) {
      let n = 0;
      const guarded = makeApi(async () => { n++; return response(listing([file])); });
      await assert.rejects(guarded.readText('/work/project/README.md')); assert.equal(n, 1);
    }
    for (const path of ['/work/project/.env', '/work/project/auth.json', '/work/project/a.png', '/work/project/a.key']) {
      let n = 0; const guarded = makeApi(async () => { n++; return response({}); });
      await assert.rejects(guarded.readText(path)); assert.equal(n, 0);
      await assert.rejects(guarded.diff(path)); assert.equal(n, 0);
    }
  });
  await test('response canonical path mismatch is never rendered', async () => {
    await assert.rejects(makeApi(async () => response(listing([], '/elsewhere'))).list('/work/project'), /exact workspace/);
    const guarded = makeApi(async url => response(String(url).includes('/read?') ? { path: '/elsewhere/README.md', size: 5, data_url: 'data:text/plain;base64,aGVsbG8=' } : listing([entry('README.md')])));
    await assert.rejects(guarded.readText('/work/project/README.md'), /exact file/);
  });
  await test('malformed JSON, HTML login redirect, oversized streamed body are rejected', async () => {
    for (const res of [new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), new Response('{bad', { headers: { 'content-type': 'application/json' } }), new Response('x'.repeat(WORKSPACE_LIMITS.responseBytes + 1), { headers: { 'content-type': 'application/json' } })]) await assert.rejects(makeApi(async () => res).list('/work/project'));
  });
  await test('content controls, invalid UTF-8 and likely private keys never render', async () => {
    for (const bytes of [Buffer.from('a\0b'), Buffer.from([0xff]), Buffer.from('-----BEGIN PRIVATE KEY-----\nfixture')]) {
      const guarded = makeApi(async url => response(String(url).includes('/read?') ? { path: '/work/project/README.md', size: bytes.length, data_url: `data:text/plain;base64,${bytes.toString('base64')}` } : listing([entry('README.md', { size: bytes.length })])));
      await assert.rejects(guarded.readText('/work/project/README.md'));
    }
  });
  await test('text and entry display limits are explicit', async () => {
    const bytes = Buffer.from('line\n'.repeat(1400));
    const guarded = makeApi(async url => response(String(url).includes('/read?') ? { path: '/work/project/README.md', size: bytes.length, data_url: `data:text/plain;base64,${bytes.toString('base64')}` } : listing([entry('README.md', { size: bytes.length })])));
    const text = await guarded.readText('/work/project/README.md'); assert.equal(text.truncated, true); assert.equal(text.text.split('\n').length, 1200);
    const many = await makeApi(async () => response(listing(Array.from({ length: 205 }, (_, n) => entry(`file-${n}.md`))))).list('/work/project');
    assert.equal(many.entries.length, 200); assert.equal(many.omitted, true);
  });
  await test('abort before dispatch and during fetch cancel without fallback', async () => {
    const before = new AbortController(); before.abort(); let n = 0;
    await assert.rejects(makeApi(async () => { n++; }).list('/work/project', before.signal), { name: 'AbortError' }); assert.equal(n, 0);
    const during = new AbortController();
    const pending = makeApi((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))); })).list('/work/project', during.signal);
    during.abort(); await assert.rejects(pending, { name: 'AbortError' });
  });
  await test('timeout aborts the real request signal, with a safe timeout error', async () => {
    let aborted = false;
    const slow = new WorkspaceClient(conn, client, session, { timeoutMs: 5, fetch: (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled', 'AbortError')); }); }) });
    await assert.rejects(slow.list('/work/project'), error => error.code === 'timeout'); assert.equal(aborted, true);
  });
  await test('different-port preview is a candidate, never an authorization to navigate', () => {
    assert.equal(safePreviewUrl('https://gateway.example:8450/reviews/desktop-parity/parity-shell/', conn.url, 'https://gateway.example:8451'), 'https://gateway.example:8450/reviews/desktop-parity/parity-shell/');
  });
  await test('preview links refuse unsafe schemes, traversal, credentials and authenticated origin', () => {
    assert.equal(safePreviewUrl('https://preview.example/output/', conn.url, 'https://app.example'), 'https://preview.example/output/');
    for (const raw of ['javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a', 'http://preview.example/a', 'https://u:p@preview.example/a', 'https://gateway.example/preview', 'https://127.0.0.1/a', 'https://localhost/a', 'https://preview.example/a?token=x', 'https://preview.example/a#token', 'https://preview.example/a/../safe', 'https://preview.example/%2e%2e/a', 'https://preview.example/.env', 'https://preview.example/a?', 'https://preview.example/a#', 'https://@preview.example/a', 'https://localhost./a', 'https://127.1/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a']) assert.equal(safePreviewUrl(raw, conn.url, 'https://app.example'), null, raw);
  });
  await test('exact app origin and unknown preview scope fail closed', () => {
    for (const raw of ['https://app.example/output/', 'https://app.example:443/output/']) assert.equal(safePreviewUrl(raw, conn.url, 'https://app.example'), null);
    for (const origin of ['', 'null', 'file:///', 'not-an-origin']) assert.equal(safePreviewUrl('https://preview.example/a', conn.url, origin), null);
    for (const gateway of ['', 'not-a-gateway', 'file:///tmp/a']) assert.equal(safePreviewUrl('https://preview.example/a', gateway, 'https://app.example'), null);
  });
  console.log(`Workspace: ${passed} tests passed (fixtures only; no live API claims).`);
  const browserScript = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import Workspace from './src/screens/Workspace';
    import './src/theme.css';
    const errors = []; window.addEventListener('error', event => errors.push(event.message));
    const checks = []; function ok(value, message) { if (!value) throw new Error(message); checks.push(message); }
    const pause = () => new Promise(resolve => setTimeout(resolve, 25));
    async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(); } throw Error('DOM state timed out: ' + document.querySelector('#root').textContent.slice(-800)); }
    const button = label => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);
    const row = label => [...document.querySelectorAll('.workspace-row')].find(el => el.textContent.includes(label));
    const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    let mode = 'normal', pending, back = 0; const requests = [];
    const opens = []; window.open = (...args) => { opens.push(args); return null; };
    async function inputUrl(value) {
      const input = document.querySelector('#workspace-preview-url');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    }
    const conn = { id: 'a', label: 'A', url: 'https://gateway.example', username: '', password: '' };
    const listeners = new Set();
    const client = { url: conn.url, connectionState: 'open', addStateHandler: handler => { listeners.add(handler); return () => listeners.delete(handler); } };
    let session = { id: 's1', profile: 'builder', cwd: '/work/project', git_repo_root: '/work/project' };
    globalThis.fetch = async (url, init) => {
      const u = new URL(url); requests.push({ url: u, init });
      if (mode === 'pending') return new Promise(resolve => { pending = { resolve, signal: init.signal }; });
      if (mode === 'error') return new Response('private error body', { status: 403 });
      const path = u.searchParams.get('path');
      if (u.pathname === '/api/files/read') return json({ path, size: 5, data_url: 'data:text/plain;base64,aGVsbG8=' });
      if (u.pathname === '/api/git/status') return json({ branch: 'main', detached: false, changed: 1, files: [{ path: 'README.md', staged: true, unstaged: false, untracked: false, conflicted: false }] });
      if (u.pathname === '/api/git/file-diff') return json({ diff: '-old\\n+new' });
      return json({ path, entries: path.endsWith('/src') || mode === 'empty' ? [] : [{ name: 'README.md', path: path + '/README.md', is_directory: false, size: 5 }, { name: 'src', path: path + '/src', is_directory: true, size: null }, { name: '.env', path: path + '/.env', is_directory: false, size: 10 }] });
    };
    const root = createRoot(document.getElementById('root'));
    const render = () => flushSync(() => root.render(<Workspace conn={conn} client={client} session={session} onBack={() => back++} />));
    async function run() {
      render(); await until(() => row('README.md'));
      ok(!document.querySelector('#root').textContent.includes('.env'), 'secret names hidden');
      ok(!document.querySelector('header') && !document.querySelector('[aria-label="Primary"]'), 'no duplicate app shell');
      ok(document.documentElement.scrollWidth <= window.innerWidth, 'no page overflow');
      ok([...document.querySelectorAll('button')].every(el => el.getBoundingClientRect().height >= 44), '44px button targets');
      row('src').click(); await until(() => document.body.textContent.includes('No visible files'));
      ok(button('Parent folder'), 'folder navigation has bounded parent');
      button('Parent folder').click(); await until(() => row('README.md'));
      row('README.md').click(); await until(() => document.querySelector('.workspace-code'));
      ok(document.querySelector('.workspace-code').textContent === 'hello', 'selected text rendered from response');
      button('File list').click(); await until(() => row('README.md'));
      button('Git').click(); await until(() => document.querySelector('.workspace-branch'));
      row('README.md').click(); await until(() => document.querySelector('.workspace-code'));
      ok(document.querySelector('.workspace-code').textContent === '-old\\n+new', 'one-file Git diff rendered');
      const before = requests.length; button('Terminal').click(); await until(() => document.body.textContent.includes('Terminal unavailable on mobile'));
      ok(!document.querySelector('textarea') && requests.length === before, 'terminal never executes or requests');
      button('Preview').click(); await until(() => document.querySelector('input'));
      ok(!document.querySelector('iframe') && requests.length === before, 'preview not an iframe or automatic fetch');
      const candidate = 'https://gateway.example:8450/reviews/desktop-parity/parity-shell/';
      await inputUrl(candidate);
      ok(button('Review preview link') && !button('Trust and open preview') && opens.length === 0 && !document.querySelector('.workspace-preview a[href]'), 'different-port candidate has no navigation before review');
      button('Review preview link').click(); await pause();
      ok(button('Trust and open preview') && opens.length === 0, 'review alone does not open');
      const warning = document.querySelector('[role="alertdialog"]');
      ok(warning && warning.textContent.includes(candidate) && warning.textContent.includes(conn.url) && warning.textContent.includes('Browser host cookies may accompany navigation') && warning.textContent.includes('different port'), 'trust review identifies exact URL, gateway and host-cookie risk');
      const oldConfirm = button('Trust and open preview');
      await inputUrl(candidate + 'changed/');
      ok(!button('Trust and open preview'), 'changed URL clears pending confirmation');
      oldConfirm.click(); ok(opens.length === 0, 'detached stale confirmation cannot navigate');
      await inputUrl(candidate);
      ok(!button('Trust and open preview'), 'returning to old URL does not restore trust');
      button('Review preview link').click(); await pause();
      button('Cancel preview').click(); await pause();
      ok(!button('Trust and open preview') && opens.length === 0, 'cancel clears confirmation without opening');
      button('Review preview link').click(); await pause();
      button('Trust and open preview').click(); await pause();
      ok(JSON.stringify(opens) === JSON.stringify([[candidate, '_blank', 'noopener,noreferrer']]), 'only explicit trust opens exact URL in isolated new tab');
      ok(!button('Trust and open preview') && requests.length === before, 'confirmation consumed without preview requests');
      for (const denied of [location.origin + '/preview/', conn.url + '/preview/', 'https://localhost/a', 'https://preview.example/a?token=x']) {
        await inputUrl(denied);
        ok(!button('Review preview link') && !button('Trust and open preview') && !document.querySelector('.workspace-preview a[href]'), 'unsafe or exact-origin URL refused: ' + denied);
      }
      await inputUrl(candidate); button('Review preview link').click(); await pause();
      const priorSession = session;
      session = { ...session, profile: undefined }; render(); await pause();
      ok(document.body.textContent.includes('Workspace unavailable') && !document.querySelector('input') && requests.length === before && opens.length === 1, 'unknown scope cannot preview or request');
      session = priorSession; render(); await until(() => row('README.md'));
      button('Preview').click(); await until(() => document.querySelector('input'));
      ok(!document.querySelector('input').value && !button('Trust and open preview'), 'scope restoration does not restore confirmation');
      await inputUrl(candidate); button('Review preview link').click(); await pause();
      conn.id = 'changed-gateway'; session = { ...session }; render(); await until(() => row('README.md'));
      button('Preview').click(); await until(() => document.querySelector('input'));
      ok(!document.querySelector('input').value && !button('Trust and open preview'), 'gateway identity change clears URL and confirmation');
      await inputUrl(candidate); button('Review preview link').click(); await pause();
      client.url = 'https://other.example';
      button('Trust and open preview').click(); await pause();
      ok(opens.length === 1 && !button('Trust and open preview'), 'live gateway change at click refuses stale confirmation');
      client.url = conn.url;
      ok(!document.querySelector('iframe, object, embed') && document.documentElement.scrollWidth <= window.innerWidth, 'preview remains text-only without mobile overflow');
      session = { ...session, cwd: '/home/iqbal/workspace/.worktrees/hermes-mobile/feature', git_repo_root: '/home/iqbal/workspace/.worktrees/hermes-mobile/feature' }; render(); await until(() => row('README.md'));
      ok(document.body.textContent.includes(session.cwd), 'real component accepts explicit worktree session cwd');
      row('README.md').click(); await until(() => document.querySelector('.workspace-code'));
      ok(document.querySelector('.workspace-code').textContent === 'hello', 'worktree Files text read remains usable');
      button('Git').click(); await until(() => document.querySelector('.workspace-branch'));
      row('README.md').click(); await until(() => document.querySelector('.workspace-code'));
      ok(document.querySelector('.workspace-code').textContent === '-old\\n+new', 'worktree Git diff remains usable');
      button('Files').click(); await until(() => row('README.md'));
      mode = 'error'; button('Refresh').click(); await until(() => document.querySelector('[role="alert"]'));
      ok(!document.querySelector('[role="alert"]').textContent.includes('private error body'), 'error body not leaked');
      mode = 'normal'; button('Try again').click(); await until(() => row('README.md'));
      client.connectionState = 'closed'; listeners.forEach(handler => handler('closed')); await until(() => document.body.textContent.includes('Gateway offline'));
      ok(!row('README.md'), 'offline hides stale files');
      client.connectionState = 'open'; listeners.forEach(handler => handler('open')); await until(() => row('README.md'));
      mode = 'pending'; button('Refresh').click(); await until(() => pending);
      mode = 'normal'; session = { ...session, id: 's2', profile: 'studio', cwd: '/work/other', git_repo_root: '/work/other' }; render();
      await until(() => row('README.md'));
      ok(pending.signal.aborted, 'context switch cancels old request');
      pending.resolve(json({ path: '/work/project', entries: [{ name: 'STALE.md', path: '/work/project/STALE.md', is_directory: false, size: 1 }] })); await pause();
      ok(!document.body.textContent.includes('STALE.md') && document.body.textContent.includes('/work/other'), 'late response cannot leak across scope');
      ok(requests.at(-1).url.searchParams.get('profile') === 'studio', 'new profile request retained');
      button('Back to conversation').click(); ok(back === 1, 'parent back callback retained');
      ok(errors.length === 0, 'no browser errors');
      document.getElementById('result').textContent = JSON.stringify({ ok: true, checks: checks.length, viewport: window.innerWidth });
    }
    run().catch(error => { document.getElementById('result').textContent = JSON.stringify({ ok: false, error: error.message, checks }); });
  `;
  buildSync({ stdin: { contents: browserScript, loader: 'tsx', resolveDir: join(here, '..') }, outfile: join(temp, 'browser.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  writeFileSync(join(temp, 'browser.html'), '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="browser.css"><div id="root"></div><pre id="result"></pre><script src="browser.js"></script>');
  // CDP pipe avoids Chrome's 500px minimum desktop window and opens no debug port.
  for (const width of [360, 390, 430]) {
    const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(temp, `chrome-${width}`)}`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    const pending = new Map(); let nextId = 0; let buffer = '';
    let stderr = '', failure;
    const started = Date.now();
    const diagnostic = message => new Error(`${message}; Chrome pid=${chrome.pid ?? 'not spawned'} elapsed=${Date.now() - started}ms exit=${chrome.exitCode} signal=${chrome.signalCode}\nChrome stderr (last 12000 characters):\n${stderr || '(empty)'}`);
    const fail = message => {
      failure = diagnostic(message);
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(failure); }
      pending.clear();
    };
    chrome.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    chrome.once('spawn', () => console.log(`Workspace Chrome startup: executable=${process.env.CHROME_BIN || 'google-chrome'} pid=${chrome.pid} viewport=${width}`));
    const exited = new Promise(resolve => {
      chrome.once('close', (code, signal) => { fail(`Chrome closed (${code ?? signal})`); resolve(); });
    });
    chrome.once('error', error => fail(`Chrome spawn failed: ${error.message}`));
    chrome.stdio[3].on('error', error => fail(`Chrome CDP input: ${error.message}`));
    chrome.stdio[4].on('error', error => fail(`Chrome CDP output: ${error.message}`));
    const unexpectedRequests = [];
    const fixtureOrigin = 'https://gateway.example:8451';
    chrome.stdio[4].on('data', chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message.method === 'Fetch.requestPaused') {
          const { requestId, request } = message.params;
          const files = new Map(['/browser.html', '/browser.js', '/browser.css'].map(path => [fixtureOrigin + path, path.slice(1)]));
          const file = files.get(request.url);
          // Fulfill the entire synthetic HTTPS origin locally, before any network request.
          if (file) void rpc('Fetch.fulfillRequest', { requestId, responseCode: 200, body: readFileSync(join(temp, file)).toString('base64'), responseHeaders: [{ name: 'Content-Type', value: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }] }, message.sessionId);
          else if (request.url === fixtureOrigin + '/favicon.ico') void rpc('Fetch.fulfillRequest', { requestId, responseCode: 204 }, message.sessionId);
          else { unexpectedRequests.push(request.url); void rpc('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, message.sessionId); }
        }
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id); clearTimeout(waiter.timer);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
      }
    });
    function rpc(method, params = {}, sessionId) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(diagnostic(`CDP timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      });
    }
    try {
      const { targetId } = await rpc('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true });
      await rpc('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
      await rpc('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
      await rpc('Page.navigate', { url: fixtureOrigin + '/browser.html' }, sessionId);
      let raw = '';
      for (let i = 0; i < 240; i++) {
        const result = await rpc('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent || ''", returnByValue: true }, sessionId);
        raw = result.result.value;
        if (raw) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(raw, 'Browser suite did not produce a result');
      const result = JSON.parse(raw);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.viewport, width, 'Chrome must exercise the requested mobile viewport');
      assert.deepEqual(unexpectedRequests, [], 'no preview or other external request may be attempted');
      console.log(`Workspace browser ${width}x844: ${result.checks} checks passed (mock transport, real React components).`);
    } finally {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      chrome.kill(); await exited;
    }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
