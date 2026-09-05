// Fictional wire fixtures. Inject before the production bundle; no React/store hooks.
export const FIXTURE = {
  gateway: { id: 'qa-gateway', label: 'QA Fictional Gateway', url: 'https://gateway.production-qa.invalid', username: 'fixture-user', password: 'NOT-A-REAL-PASSWORD' },
  sessions: [
    { id: 'qa-project-session', title: 'QA Project conversation', preview: 'Fictional project history', started_at: 1700000000, message_count: 2, source: 'cli', profile: 'default', cwd: '/fictional/qa-project', git_repo_root: '/fictional/qa-project', git_branch: 'fixture-branch' },
    { id: 'qa-recent-session', title: 'QA Recent conversation', preview: 'Fictional recent history', started_at: 1700000001, message_count: 2, source: 'cli', profile: 'default', cwd: '/fictional/qa-recent' },
  ],
  bot: { id: 'qa-bot-session', title: 'Bot Chat', preview: 'Fictional bot history', started_at: 1700000002, message_count: 2, source: 'bots', profile: 'qa-bot', cwd: '/fictional/qa-bot' },
};

export function installProductionFixtures(fixture) {
  const f = structuredClone(fixture);
  const trace = [], violations = [], sockets = [], held = new Map();
  const control = {
    trace, violations, mode: 'normal', authenticated: false, approval: false,
    hold: [], errors: {}, unsupported: [], permits: {}, empty: [],
    currentProfiles: [], cronOwner: 'default',
    createdHistory: [],
    release(method) { this.hold = this.hold.filter(x => x !== method); for (const finish of held.get(method) || []) finish(); held.delete(method); },
    emit(type, session_id, payload) {
      if (type === 'message.complete' && session_id === 'qa-created-session') {
        this.createdHistory = [{ role: 'assistant', content: payload.text }];
        const session = f.sessions.find(s => s.id === session_id);
        session.message_count = 1; session.unpersisted = false;
      }
      for (const socket of sockets) if (socket.readyState === 1) socket.frame({ method: 'event', params: { type, session_id, payload } }); },
    offline() { this.mode = 'offline'; for (const socket of sockets) socket.close(); },
    online() { this.mode = 'normal'; },
  };
  Object.defineProperty(window, '__productionFixture', { value: control });
  // This key exists only in ChromePipe's fresh disposable browser profile.
  localStorage.clear();
  localStorage.setItem('hermes-mobile.connections.v1', JSON.stringify([f.gateway]));
  localStorage.setItem('hermes-mobile.api-server-key', 'FICTIONAL-RUNS-KEY');
  localStorage.setItem('hermes-mobile.tracked-runs.v1', JSON.stringify([{ id: 'qa-run', label: 'QA tracked run', added_at: 1700000000 }]));
  const room = { roomId: 'qa-room', name: 'QA Fixture group', members: [{ name: 'qa-bot', handle: 'qa-bot', connectionId: f.gateway.id, connectionLabel: f.gateway.label }], log: [{ kind: 'user', text: 'QA group history', at: 1700000000000, thread: 'qa-thread' }], revision: 1 };
  const profiles = [
    { name: 'default', is_default: true, model: 'fixture-model', provider: 'fixture', skill_count: 1, ui_meta_revisions: { 'hermes-bots-groups': 1 }, ui_meta: { 'hermes-bots-groups': { version: 3, updatedAt: 1700000000000, rooms: { 'id:qa-room': room }, deleted: {} } } },
    { name: 'qa-bot', display_name: 'QA Fixture Bot', description: 'Fictional profile', model: 'fixture-model', provider: 'fixture', canonical_session: f.bot, ui_meta_revisions: {}, ui_meta: { 'hermes-bots': { displayName: 'QA Fixture Bot', handle: 'qa-bot' } } },
  ];
  const history = sid => sid === 'qa-created-session' ? control.createdHistory : [{ role: 'user', content: `QA restored question ${sid}` }, { role: 'assistant', content: (sid === 'qa-project-session' ? Array.from({length: 24}, (_, n) => `Fictional history paragraph ${n + 1}. This long transcript exercises real scroll restoration, without sending a prompt.`).join('\n\n') + '\n\n' : '') + `QA restored answer ${sid}` }];
  const info = profile => ({ model: 'fixture-model', provider: 'fixture', profile_name: profile || 'default', cwd: profile === 'qa-bot' ? '/fictional/qa-bot' : '/fictional/qa-project', reasoning_effort: 'medium' });
  const sessionInfos = {};
  const project = { id: 'qa-project', label: 'QA Project', sessionCount: 1, previewSessions: [f.sessions[0]], repos: [{ id: 'qa-repo', label: 'QA Repo', groups: [{ id: 'qa-lane', label: 'fixture-branch', sessions: [f.sessions[0]] }] }] };
  const run = { object: 'hermes.run', run_id: 'qa-run', status: 'completed', session_id: 'qa-recent-session', created_at: 1700000000, model: 'fixture-model', output: 'QA fixture run output' };
  const fail = message => { violations.push(message); throw new Error(message); };
  const wait = method => !control.hold.includes(method) ? Promise.resolve() : new Promise(resolve => held.set(method, [...(held.get(method) || []), resolve]));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = (init.method || input.method || 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (![f.gateway.url, location.origin].includes(url.origin)) return fail(`Unexpected fetch origin: ${url.origin}`);
    const receipt = { transport: 'fetch', route, query: url.search, body: init.body ? JSON.parse(init.body) : null };
    trace.push(receipt);
    await wait(route);
    if (control.mode === 'offline') throw new TypeError('QA fixture offline');
    if (control.unsupported.includes(route)) return json({ error: 'QA fixture unsupported endpoint' }, 404);
    if (control.errors[route]) return json({ error: { message: control.errors[route] } }, 503);
    if (route === 'GET /api/status') return json({ status: 'ok', version: 'fixture-only' });
    if (route === 'POST /api/auth/ws-ticket') return control.authenticated ? json({ ticket: 'FICTIONAL-ONE-USE-TICKET' }) : json({ error: 'fixture login required' }, 401);
    if (route === 'POST /auth/password-login') {
      const body = JSON.parse(init.body);
      if (body.username !== f.gateway.username || body.password !== f.gateway.password || body.provider !== 'basic') return fail('Unexpected fictional login payload');
      control.authenticated = true; return json({ ok: true });
    }
    if (method === 'GET' && /^\/api\/sessions\/(qa-project-session|qa-recent-session|qa-bot-session|qa-created-session)\/messages$/.test(url.pathname)) {
      const sid = url.pathname.split('/')[3];
      if (sid === 'qa-created-session' && !control.createdHistory.length) return json({error:'Session not found'}, 404);
      if (sid === f.bot.id && url.searchParams.get('profile') !== 'qa-bot') return fail('Bot REST history lost profile scope');
      return json({ session_id: sid, messages: history(sid), pagination: { limit: 100, offset: 0, order: 'latest', returned: history(sid).length } });
    }
    if (route === 'GET /v1/capabilities') return json({ object: 'hermes.capabilities', model: 'fixture-model', features: { runs: true } });
    if (route === 'GET /v1/runs') return json({ error: { message: 'Fixture has no list endpoint; use tracked runs' } }, 405);
    if (route === 'GET /v1/runs/qa-run') return json(run);
    if (route === 'GET /v1/runs/qa-run/events') return new Response('data: {"event":"run.completed","run_id":"qa-run","output":"QA fixture run output"}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    // Production serving contract: root schema is not proxied; never invent its availability.
    if (route === 'GET /openapi.json') return json({ error: 'Root static host has no OpenAPI route' }, 404);
    // Final management-client scopedGet + check-management.mjs: current is the
    // process owner; active is deliberately a DIFFERENT sticky CLI preference.
    if (route === 'GET /api/profiles/active') {
      if (url.search) return fail('Running-profile identity takes no query');
      const current = control.currentProfiles.length ? control.currentProfiles.shift() : 'default';
      receipt.responseCurrent = current;
      return json({ current, active: 'qa-bot' });
    }
    if (['GET /api/learning/graph','GET /api/learning/node','GET /api/cron/jobs','GET /api/messaging/platforms'].includes(route)) {
      const expected = route === 'GET /api/learning/node' ? { id: 'memory:memory:0', profile: 'default' } : { profile: 'default' };
      if (url.searchParams.toString() !== new URLSearchParams(expected).toString()) return fail(`Unexpected management scope/query: ${route}${url.search}`);
      if (init.credentials !== 'include' || init.redirect !== 'error' || init.cache !== 'no-store') return fail('Management read lost cookie/redirect/cache contract');
      if (route !== 'GET /api/cron/jobs' && !trace.some(t => t.route === 'GET /api/profiles/active' && t.responseCurrent === 'default')) return fail('Management read before running-profile identity');
      if (route === 'GET /api/learning/graph') return json({ nodes: [{ id: 'memory:memory:0', kind: 'memory', label: 'QA Fixture Memory', memorySource: 'memory' }, { id: 'qa-skill', kind: 'skill' }] });
      if (route === 'GET /api/learning/node') return json({ ok: true, kind: 'memory', id: 'memory:memory:0', content: 'QA fictional private memory detail.' });
      if (route === 'GET /api/cron/jobs') return json([{ id: 'qa-job', profile: control.cronOwner, name: 'QA Fixture Schedule', state: 'paused', enabled: false, schedule_display: 'every 7d' }]);
      return json({ platforms: [{ id: 'telegram', name: 'QA Fixture Messaging', state: 'disabled', enabled: false, configured: false, gateway_running: false, env_vars: [{ key: 'QA_DO_NOT_RENDER', redacted_value: 'QA_PRIVATE_ENV' }], error_message: 'QA_PRIVATE_DIAGNOSTIC', home_channel: 'QA_PRIVATE_DESTINATION' }] });
    }
    if (route === 'GET /api/plugins/kanban/boards') return json({ boards: [{ slug: 'qa-board', name: 'QA Fixture Board' }] });
    if (route === 'GET /api/plugins/kanban/board') {
      if (url.searchParams.get('board') !== 'qa-board') return fail('Kanban requires explicit board');
      return json({ columns: [{ name: 'Todo', tasks: [{ id: 'qa-task', title: 'QA Fixture Task', status: 'todo', assignee: 'qa-bot', body: 'Fictional task only' }] }] });
    }
    if (['GET /api/files','GET /api/files/read','GET /api/git/status','GET /api/git/file-diff'].includes(route)) {
      const profile = url.searchParams.get('profile'), selected = url.searchParams.get('path');
      const root = profile === 'default' ? '/fictional/qa-project' : profile === 'qa-bot' ? '/fictional/qa-bot' : '';
      if (!root || ![root, root + '/README.md'].includes(selected)) return fail('Workspace REST lost exact profile/path context');
      if (route === 'GET /api/files') return json({ path: root, entries: control.empty.includes(route) ? [] : [{ name: 'README.md', path: root + '/README.md', is_directory: false, size: 27 }] });
      if (route === 'GET /api/files/read') {
        const text = 'QA fictional workspace text';
        return json({ path: selected, size: new TextEncoder().encode(text).length, data_url: 'data:text/plain;base64,' + btoa(text) });
      }
      if (route === 'GET /api/git/status') return json({ branch: 'fixture-branch', detached: false, changed: 1, files: [{ path: 'README.md', staged: false, unstaged: true, untracked: false, conflicted: false }] });
      if (url.searchParams.get('file') !== 'README.md') return fail('Unexpected Git diff target');
      return json({ diff: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-QA before\n+QA after\n' });
    }
    return fail(`Unregistered fetch: ${route}`);
  };
  function rpc(method, params) {
    if (control.errors[method]) throw { code: 4900, message: control.errors[method] };
    if (control.unsupported.includes(method)) throw { code: -32601, message: `QA fixture method not supported: ${method}` };
    switch (method) {
      case 'session.create': {
        if (!(control.permits[method] > 0)) return fail('Creation without harness confirmation permit');
        control.permits[method]--;
        if (f.sessions.some(s => s.id === 'qa-created-session')) return fail('Duplicate session creation');
        const session = { ...f.sessions[1], id: 'qa-created-session', title: 'QA Created conversation', message_count: 0, unpersisted: true };
        f.sessions.push(session);
        return { session_id: session.id, stored_session_id: session.id, info: info('default') };
      }
      case 'session.list': return { sessions: params.title === 'Bot Chat' ? [f.bot] : f.sessions };
      case 'projects.tree': return { projects: [project], scoped_session_ids: [f.sessions[0].id] };
      case 'projects.project_sessions': if (params.project_id !== project.id) return fail('Unknown project scope'); return { project };
      case 'profiles.list': return { profiles: control.empty.includes('profiles.list') ? [] : profiles };
      case 'profiles.describe': {
        const profile = profiles.find(p => p.name === params.name);
        if (!profile) return fail('Unknown profile description scope');
        return { name: profile.name, description: profile.description || 'QA fictional description', soul: 'QA fictional role instructions', model: { default: profile.model, provider: profile.provider }, skills: control.empty.includes('profiles.describe') ? [] : [{ name: 'qa-skill', enabled: true, label: 'QA Fixture Skill', description: 'Fictional capability' }], toolsets: [], mcp_servers: [] };
      }
      case 'session.resume': {
        const session = [...f.sessions, f.bot].find(s => s.id === params.session_id);
        if (!session) return fail(`Unknown resume session: ${params.session_id}`);
        if (session.profile === 'qa-bot' && params.profile !== 'qa-bot') return fail('Bot resume lost profile scope');
        return { session_id: session.id, stored_session_id: session.id, messages: params.omit_messages === true ? [] : history(session.id), info: sessionInfos[session.id] || info(session.profile), running: false, status: 'idle', message_count: history(session.id).length };
      }
      case 'session.events.since': return { events: [], latest_seq: 0, truncated: false, epoch: 'qa-epoch' };
      case 'approval.pending': return { approvals: control.approval ? [{ request_id: 'qa-approval', command: 'fixture-only operation (never executed)', description: 'QA explicit approval', choices: ['once', 'deny'] }] : [] };
      case 'model.options': return { ...info(), providers: [{ slug: 'fixture', name: 'QA Fixture Provider', models: ['fixture-model', 'fixture-alternative'] }] };
      case 'approval.respond':
      case 'session.delete':
      case 'profiles.configure':
      case 'config.set': {
        if (!(control.permits[method] > 0)) return fail(`Mutation without harness confirmation permit: ${method}`);
        control.permits[method]--;
        if (method === 'approval.respond') { control.approval = false; return { ok: true }; }
        if (method === 'session.delete') return { deleted: params.session_id };
        if (method === 'config.set') {
          const session = [...f.sessions, f.bot].find(s => s.id === params.session_id);
          if (!session) return fail('Model change requires known session');
          const current = sessionInfos[session.id] ||= info(session.profile);
          if (params.key === 'model') {
            if (params.value !== 'fixture-alternative --provider fixture --session') return fail('Model change lost explicit session scope');
            current.model = 'fixture-alternative';
          } else if (params.key === 'reasoning') current.reasoning_effort = params.value;
          else return fail('Unregistered config mutation key');
          return { key: params.key, value: params.value, deferred: false };
        }
        const profile = profiles.find(p => p.name === params.name);
        if (!profile) return fail('Unknown mutation profile');
        if (typeof params.description === 'string') { profile.description = params.description; return { applied: { description: true } }; }
        Object.assign(profile.ui_meta, params.ui_meta);
        return { applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots-groups': 2 } } };
      }
      default: return fail(`Unregistered RPC: ${method}`);
    }
  }
  class FixtureWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3;
    readyState = 0; bufferedAmount = 0; extensions = ''; protocol = ''; binaryType = 'blob';
    constructor(url) {
      super(); this.url = String(url);
      const expected = f.gateway.url.replace('https:', 'wss:') + '/api/ws?ticket=FICTIONAL-ONE-USE-TICKET';
      if (this.url !== expected) fail('Unexpected WebSocket target');
      trace.push({ transport: 'websocket', event: 'constructed', url: this.url }); sockets.push(this);
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.dispatchEvent(new Event('open')); this.frame({ method: 'event', params: { type: 'gateway.ready', session_id: '', payload: { replay_epoch: 'qa-epoch' } } }); }, 0);
    }
    frame(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) + '\n' })); }
    send(data) {
      if (this.readyState !== 1) fail('RPC before socket open');
      for (const line of data.trim().split('\n')) {
        const request = JSON.parse(line);
        if (request.jsonrpc !== '2.0' || request.id == null) fail('Invalid JSON-RPC request');
        trace.push({ transport: 'rpc', method: request.method, params: request.params });
        void wait(request.method).then(() => {
          try { this.frame({ jsonrpc: '2.0', id: request.id, result: rpc(request.method, request.params || {}) }); }
          catch (error) { this.frame({ jsonrpc: '2.0', id: request.id, error: { code: error.code || -32000, message: error.message } }); }
        });
      }
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'fixture transport closed', wasClean: true })); }
  }
  window.WebSocket = FixtureWebSocket;
  window.EventSource = class { constructor() { fail('Unregistered EventSource transport'); } };
  navigator.sendBeacon = () => fail('Unregistered beacon transport');
}
