import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = await mkdtemp(path.join(app, 'node_modules/.auth-restore-'));
try {
  await build({ entryPoints: [path.join(app, 'src/App.tsx')], outfile: path.join(output, 'app.mjs'), bundle: true,
    platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
    define: { 'import.meta.glob': '__fixtureGlob' }, banner: { js: 'const __fixtureGlob = () => ({});' },
    plugins: [{ name: 'screen-boundaries', setup(builder) {
      builder.onResolve({ filter: /screens\/ChatView$|screens\/ProjectBrowser$/ }, args => ({ path: args.path, namespace: 'screen' }));
      builder.onLoad({ filter: /.*/, namespace: 'screen' }, args => ({ contents: `import React from 'react'; export default props => React.createElement('fixture-screen', {screen: ${JSON.stringify(args.path)}, session: props.session, gateway: props.conn});`, loader: 'js', resolveDir: app }));
    } }],
  });
  const { default: App } = await import(pathToFileURL(path.join(output, 'app.mjs')));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const connection = { id: 'saved', label: 'Saved gateway', url: 'https://fixture.invalid', username: 'operator' };
  const session = { id: 'conversation-42', profile: 'default', title: 'Existing conversation', started_at: 1, message_count: 2, source: 'mobile' };
  const route = { screen: 'chat', profile: 'default', gateway: { id: connection.id, url: connection.url }, conversation: { id: session.id, session }, returnTo: 'chats' };
  globalThis.document = { documentElement: { style: { setProperty() {} } } };
  class Socket extends EventTarget {
    readyState = 1;
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'event', params: { type: 'gateway.ready' } }) }))); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = Socket;
  for (const status of [401, 403, 503]) {
    const values = new Map([['hermes-mobile.connections.v1', JSON.stringify([connection])]]);
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const history = { state: { shell: 1, depth: 1, route }, pushState() { throw new Error('Sign-in must not change the destination'); }, replaceState(value) { this.state = value; } };
    globalThis.window = { history, innerHeight: 844, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
    let authenticated = false;
    globalThis.fetch = async (url, init) => {
      if (url.endsWith('/api/status')) return Response.json({ version: 'fixture' });
      if (url.endsWith('/auth/password-login')) {
        assert.equal(JSON.parse(init.body).password, 'typed-secret');
        authenticated = true;
        return Response.json({ ok: true });
      }
      assert.ok(url.endsWith('/api/auth/ws-ticket'));
      return authenticated ? Response.json({ ticket: 'fixture' }) : Response.json({}, { status });
    };
    let rendered;
    try {
      await act(async () => { rendered = create(React.createElement(App)); });
      const passwords = rendered.root.findAllByProps({ type: 'password' });
      if (status === 503) {
        assert.equal(passwords.length, 0);
        assert.ok(rendered.root.findAllByType('button').some(button => button.props.children === 'Retry connection'));
      } else {
        assert.equal(passwords.length, 1, `${status}: restored route must show sign-in`);
        await act(async () => passwords[0].props.onChange({ target: { value: 'typed-secret' } }));
        await act(async () => rendered.root.findByProps({ 'aria-label': 'Sign in to Saved gateway' }).props.onClick());
        const conversation = rendered.root.findAllByType('fixture-screen').find(node => node.props.screen.endsWith('/ChatView'));
        assert.equal(conversation.props.session.id, session.id);
        assert.equal(conversation.props.gateway.id, connection.id);
        assert.equal(rendered.root.findAllByProps({ type: 'password' }).length, 0);
        assert.equal(values.get('hermes-mobile.connections.v1').includes('typed-secret'), false);
      }
      assert.equal(history.state.route.conversation.id, session.id);
    } finally {
      if (rendered) await act(async () => rendered.unmount());
    }
  }
  console.log('auth restore: PASS (401/403 sign-in preserves conversation; 503 remains retryable)');
} finally {
  await rm(output, { recursive: true, force: true });
}
