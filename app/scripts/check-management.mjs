#!/usr/bin/env node
// Deterministic public transport/confirmation seams. No gateway or local config access.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'management-check-'));
try {
  const output = join(temp, 'client.mjs');
  buildSync({ entryPoints: [join(app, 'src/lib/management-client.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { ManagementClient } = await import(pathToFileURL(output).href);
  const calls = [];
  const rpc = {
    url: 'https://gateway.example.invalid',
    async profilesList(options) { calls.push(['profiles.list', options]); return [{ name: 'research', description: 'Evidence first' }]; },
    async rpc(method, params) { calls.push([method, params]); return {}; },
  };
  const client = new ManagementClient(rpc);
  assert.deepEqual(await client.profiles(), [{ name: 'research', description: 'Evidence first', model: '', provider: '', displayName: '', skillCount: null }]);
  assert.deepEqual(calls, [['profiles.list', { includeSessions: false }]]);
  console.log('management transport: profile roster PASS');
  const snapshot = name => ({ name, description: 'Evidence first', soul: '', model: { default: 'test-model', provider: 'test-provider' }, skills: [{ name: 'research', enabled: true }], toolsets: [], mcp_servers: [] });
  let description = 'Evidence first';
  rpc.rpc = async (method, params) => {
    calls.push([method, params]);
    if (method === 'profiles.describe') return { ...snapshot(params.name), description };
    if (method === 'profiles.configure') { description = params.description; return { ok: true, applied: { description: true } }; }
    throw new Error('unexpected RPC');
  };
  const mutations = () => calls.filter(([m]) => m === 'profiles.configure');
  const review = await client.reviewDescription('research', 'Read before writing');
  assert.equal(mutations().length, 0, 'review must not write');
  await assert.rejects(client.confirmDescription(review, 'research', false), { code: 'confirmation' });
  await assert.rejects(client.confirmDescription(review, 'studio', true), { code: 'confirmation' });
  await assert.rejects(client.confirmDescription({ ...review }, 'research', true), { code: 'confirmation' });
  assert.equal(mutations().length, 0, 'confirmation bypass must not write');
  const saved = await client.confirmDescription(review, 'research', true);
  assert.equal(saved.description, 'Read before writing');
  assert.deepEqual(mutations(), [['profiles.configure', { name: 'research', description: 'Read before writing' }]]);
  assert.equal(calls.at(-1)[0], 'profiles.describe', 'success requires exact-target readback');
  await assert.rejects(client.confirmDescription(review, 'research', true), { code: 'confirmation' });
  const stale = await client.reviewDescription('research', 'New value'); description = 'Someone else edited';
  await assert.rejects(client.confirmDescription(stale, 'research', true), { code: 'conflict' });
  assert.equal(mutations().length, 1);
  console.log('management transport: explicit confirmation, isolation, one-shot and conflict PASS');
  const requests = [];
  let currentProfile = 'research';
  let responseBody = [{ id: 'job-1', profile: 'research', name: 'Weekly check', state: 'paused', enabled: false, schedule_display: 'every 7d' }];
  let status = 200;
  const fetcher = async (url, init) => {
    requests.push([url, init]);
    // Real serving shape: static root, /api proxy. No schema route is available.
    if (!new URL(url).pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    if (url.includes('openapi')) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(url.endsWith('/api/profiles/active') ? { current: currentProfile, active: 'studio' } : responseBody), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const rest = new ManagementClient(rpc, fetcher);
  const jobs = await rest.schedules('research');
  assert.equal(jobs[0].profile, 'research');
  assert.equal(jobs[0].schedule, 'every 7d');
  assert.equal(requests.at(-1)[0], 'https://gateway.example.invalid/api/cron/jobs?profile=research');
  assert.equal(requests.at(-1)[1].credentials, 'include');
  assert.equal(requests.at(-1)[1].redirect, 'error');
  assert.equal(requests.at(-1)[1].method, 'GET');
  assert.equal(requests.at(-1)[1].headers.Authorization, undefined);
  for (const profile of ['', 'current', 'all', 'custom', 'Research', '../research', 'research ']) {
    const before = requests.length;
    await assert.rejects(rest.schedules(profile), { code: 'scope' });
    assert.equal(requests.length, before, 'invalid profile must not send anything');
  }
  responseBody[0].profile = 'default';
  await assert.rejects(rest.schedules('research'), { code: 'scope' });
  currentProfile = 'default';
  const before = requests.length;
  await assert.rejects(rest.memories('research'), { code: 'scope' });
  assert.equal(requests.length, before + 1, 'different running profile must not fetch memory');
  assert.equal(requests.at(-1)[0], 'https://gateway.example.invalid/api/profiles/active');
  currentProfile = 'research';
  for (const [http, code] of [[401, 'auth'], [403, 'auth'], [404, 'unsupported'], [500, 'network']]) {
    status = http;
    await assert.rejects(rest.schedules('research'), error => error.code === code && error.outcome === 'none' && error.message.includes('No state changed.'));
  }
  status = 200;
  responseBody = { platforms: [{ id: 'telegram', name: 'Telegram', enabled: true, configured: true, state: 'connected', gateway_running: true, env_vars: [{ key: 'DO_NOT_RENDER', redacted_value: 'hidden' }], error_message: 'private diagnostic', home_channel: 'private destination' }] };
  const platforms = await rest.messaging('research');
  assert.deepEqual(Object.keys(platforms[0]).sort(), ['configured', 'description', 'enabled', 'gatewayRunning', 'id', 'name', 'state'].sort());
  responseBody = { nodes: [{ id: 'memory:memory:0', kind: 'memory', label: 'Prefer brief answers', memorySource: 'memory' }, { id: 'research', kind: 'skill' }] };
  assert.deepEqual(await rest.memories('research'), [{ id: 'memory:memory:0', label: 'Prefer brief answers', source: 'memory' }]);
  responseBody = { ok: true, kind: 'memory', id: 'memory:memory:0', content: 'Prefer brief answers.' };
  assert.equal(await rest.memoryDetail('research', 'memory:memory:0'), 'Prefer brief answers.');
  responseBody.id = 'memory:memory:1';
  await assert.rejects(rest.memoryDetail('research', 'memory:memory:0'), { code: 'invalid' });
  let aborted = false;
  const slow = new ManagementClient(rpc, async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })), 5);
  await assert.rejects(slow.schedules('research'), { code: 'timeout' });
  assert.equal(aborted, true);
  const controller = new AbortController(); controller.abort();
  const previousRequests = requests.length;
  await assert.rejects(rest.schedules('research', controller.signal), { code: 'aborted' });
  assert.equal(requests.length, previousRequests);
  const failing = new ManagementClient({ ...rpc, rpc: async () => { throw { code: -32601, message: 'private error text' }; } });
  await assert.rejects(failing.describe('research'), e => e.code === 'unsupported' && !e.message.includes('private error'));
  const crossed = new ManagementClient({ ...rpc, rpc: async () => snapshot('default') });
  await assert.rejects(crossed.describe('research'), { code: 'scope' });
  assert.equal(requests.some(([url]) => url.includes('openapi')), false, 'static root must never be used for schema discovery');
  const preAbort = new AbortController();
  const callCount = calls.length;
  const abortedRead = client.describe('research', preAbort.signal); preAbort.abort();
  await assert.rejects(abortedRead, { code: 'aborted' });
  await Promise.resolve();
  assert.equal(calls.length, callCount, 'aborting before RPC dispatch must prevent the call');
  for (const badAck of [null, {}, { applied: null }, { applied: {} }]) {
    const broken = new ManagementClient({ ...rpc, rpc: async method => method === 'profiles.configure' ? badAck : snapshot('research') });
    const change = await broken.reviewDescription('research', 'Updated note');
    await assert.rejects(broken.confirmDescription(change, 'research', true), e => e.outcome === 'unknown' && !e.message.includes('No state changed'));
  }
  const malformed = new ManagementClient(rpc, async () => new Response('<html>Static app</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(malformed.schedules('research'), { code: 'invalid' });
  const overLimit = new ManagementClient(rpc, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(overLimit.schedules('research'), { code: 'invalid' });
  const invalidJson = new ManagementClient(rpc, async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(invalidJson.schedules('research'), { code: 'invalid' });
  const pendingOnOtherGateway = await client.reviewDescription('research', 'Other gateway test');
  await assert.rejects(new ManagementClient(rpc).confirmDescription(pendingOnOtherGateway, 'research', true), { code: 'confirmation' });
  let streamCancelled = false;
  const stuckBody = new ManagementClient(rpc, async () => new Response(new ReadableStream({ cancel() { streamCancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }), 5);
  await assert.rejects(stuckBody.schedules('research'), { code: 'timeout' });
  assert.equal(streamCancelled, true, 'body timeout must cancel the reader');
  const boardRequests = [];
  const kanban = new ManagementClient(rpc, async (url, init) => {
    boardRequests.push([url, init]);
    const body = url.includes('/boards?') ? { boards: [{ slug: 'work', name: 'Work' }] } : { columns: [{ name: 'todo', tasks: [{ id: 'task-1', title: 'Read brief', status: 'todo', assignee: 'research', body: 'Read only.' }] }] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.deepEqual(await kanban.boards(), [{ slug: 'work', name: 'Work' }]);
  assert.equal((await kanban.board('work'))[0].tasks[0].title, 'Read brief');
  assert.equal(boardRequests.at(-1)[0], 'https://gateway.example.invalid/api/plugins/kanban/board?board=work&include_archived=false');
  await assert.rejects(kanban.board('missing'), { code: 'scope' });
  await assert.rejects(kanban.board(''), { code: 'scope' });
  assert.equal(boardRequests.every(([, init]) => init.method === 'GET'), true);
  console.log('management transport: REST contracts, projections, auth, scope, bounded bodies, cancellation, unknown writes and Kanban PASS');
  const wireOutput = join(temp, 'hermes.mjs');
  buildSync({ entryPoints: [join(app, 'src/lib/hermes-client.ts')], outfile: wireOutput, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { HermesConnection } = await import(pathToFileURL(wireOutput).href);
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  const frames = [];
  class FakeSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method: 'event', params: { type: 'gateway.ready' } }) }))); }
    send(data) {
      const frame = JSON.parse(data); frames.push(frame);
      const result = frame.method === 'profiles.list' ? { profiles: [{ name: 'research' }] } : snapshot(frame.params.name);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) })));
    }
    close() {}
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ ticket: 'fixture-ticket' }), { headers: { 'Content-Type': 'application/json' } });
  globalThis.WebSocket = FakeSocket;
  const connection = new HermesConnection({ url: 'https://gateway.example.invalid', losslessReconnect: false });
  try {
    await connection.connect();
    const real = new ManagementClient(connection);
    await real.profiles(); await real.describe('research');
    assert.deepEqual(frames.map(({ method, params }) => ({ method, params })), [
      { method: 'profiles.list', params: { include_sessions: false } },
      { method: 'profiles.describe', params: { name: 'research' } },
    ]);
  } finally { connection.disconnect(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; }
  console.log('management wire: actual HermesConnection JSON-RPC serialization PASS');
  if (process.argv.includes('--browser')) await browserCheck();
} finally { rmSync(temp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }

async function browserCheck() {
  const fixture = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Manage from './src/screens/Manage';
    import {ManageViews} from './src/lib/shell-state';
    const calls = [], requests = [], errors = [];
    let description = 'Evidence first', failRead = false;
    addEventListener('error', e => errors.push(e.message));
    addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
    const client = {
      url: 'https://gateway.example.invalid',
      async profilesList() { return [{name:'research', description}, {name:'studio', description:'Studio only'}]; },
      async rpc(method, params) {
        calls.push({method, params});
        if (method === 'profiles.configure') { description = params.description; return {ok:true, applied:{description:true}}; }
        return {name:params.name, description:params.name === 'research' ? description : 'Studio only', soul:'Read carefully.', model:{default:'test-model', provider:'test-provider'}, skills:[{name:'research-skill', enabled:true}], toolsets:[{name:'files',label:'Files',enabled:true,description:'Read workspace files',tool_count:2}], mcp_servers:[{name:'catalog',transport:'stdio',enabled:false}]};
      }
    };
    window.fetch = async (url, init) => {
      requests.push({url, method:init.method});
      if (!url.startsWith(client.url + '/api/')) throw new Error('unexpected external request');
      if (failRead) return new Response('{}', {status:401,headers:{'Content-Type':'application/json'}});
      let body;
      if (url.includes('/profiles/active')) body={current:'research',active:'studio'};
      else if(url.includes('/learning/graph')) body={nodes:[{id:'memory:memory:0',kind:'memory',label:'Brief answers',memorySource:'memory'}]};
      else if(url.includes('/learning/node')) body={ok:true,id:'memory:memory:0',kind:'memory',content:'Prefer brief answers.'};
      else if(url.includes('/cron/jobs')) body=[{id:'job-1',profile:'research',name:'Weekly check',state:'paused',enabled:false,schedule_display:'every 7d'}];
      else if(url.includes('/messaging/platforms')) body={platforms:[{id:'telegram',name:'Telegram',state:'disabled',enabled:false,configured:false,gateway_running:false}]};
      else if(url.includes('/kanban/boards')) body={boards:[{slug:'work',name:'Work'}]};
      else if(url.includes('/kanban/board?')) body={columns:[{name:'todo',tasks:[{id:'task-1',title:'Read brief',status:'todo',assignee:'research',body:'Only inspect this task.'}]}]};
      else return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    };
    let settings=0, bots=0, workspace=0;
    const root=createRoot(document.getElementById('root'));
    const props={navigationViews:new ManageViews(),conn:{id:'device',url:client.url,label:'Test gateway',username:'',password:''},client,onSettings:()=>settings++,onBots:()=>bots++,onWorkspace:()=>workspace++};
    root.render(<Manage {...props}/>);
    const tick=()=>new Promise(r=>setTimeout(r,30));
    const check=(ok, label)=>{if(!ok)throw new Error(label)};
    const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
    const click=async label=>{const b=button(label);check(b,'missing button '+label);b.click();await tick();};
    const select=async name=>{const el=document.querySelector('select');el.value=name;el.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
    const content=()=>document.querySelector('.manage').textContent;
    const writes=()=>calls.filter(c=>c.method==='profiles.configure').length;
    async function run(){
      for(let i=0;i<20&&!document.querySelector('option[value="research"]');i++)await tick();
      check(!document.querySelector('header,main,nav'), 'Manage must not add an application shell');
      check(document.querySelector('select').value==='', 'must not silently select default profile');
      await click('Profiles2 profiles reported by this gateway');
      await select('research');
      for(let i=0;i<20&&!document.querySelector('textarea');i++)await tick();
      const edit=value=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
      edit('Reviewed description');await tick();
      await click('Review description change');check(document.querySelector('dialog[open]'),'review must open confirmation');check(writes()===0,'first click cannot write');
      await click('Cancel');check(writes()===0,'cancel cannot write');
      await click('Review description change');await click('Confirm & save description');
      check(writes()===1,'second confirmation sends exactly one write');
      check(content().includes('saved and verified'),'must display verified receipt');
      check(calls.at(-1).method==='profiles.describe','must read back actual profile');
      await click('Review description change');await click('Cancel');
      await select('studio');check(document.querySelector('textarea').value==='Studio only','draft cannot leak across profiles');
      await select('research');check(document.querySelector('textarea').value==='Reviewed description','research readback retained');
      await click('Back to Manage');
      await click('CapabilitiesInstalled skills, toolsets and MCP configuration');check(content().includes('research-skill'),'real capabilities render');
      await click('Back to Manage');await click('MemoryRead profile notes from MEMORY.md and USER.md');
      check(content().includes('Brief answers'),'memory list renders');
      document.querySelector('.manage-detail summary').click();await tick();check(content().includes('Prefer brief answers.'),'memory detail loads');
      await select('studio');check(content().includes('No state changed.'),'noncurrent profile must fail closed');
      check(!content().includes('Prefer brief answers.'),'previous memory cannot leak across scope');
      await select('research');await click('Back to Manage');
      await click('Schedules & cronProfile-owned jobs, cadence and next run');check(content().includes('Weekly check'),'cron list renders');
      await click('Back to Manage');await click('MessagingChannel configuration and reported state');check(content().includes('Telegram'),'messaging renders');
      await click('Back to Manage');const before=requests.length;await click('WebhooksProfile transport unavailable · inspect the boundary');check(requests.length===before,'unscoped webhook must never be fetched');
      await click('Back to Manage');await click('KanbanOfficial bundled plugin · gateway-wide boards');await click('Workwork');check(content().includes('Read brief'),'real board card renders');
      check(requests.some(r=>r.url.includes('board=work')),'board must be explicit');
      await click('Back to Manage');await click('Devices & gatewaysSaved connections and authentication');await click('Bots & routinesOpen the existing bot workspace');await click('Workspace toolsFiles and review in their conversation context');
      check(settings===1&&bots===1&&workspace===1,'shared-shell callbacks remain functional');
      failRead=true;await click('Schedules & cronProfile-owned jobs, cadence and next run');check(content().includes('No state changed.'),'401 must show a no-change error');
      failRead=false;await click('Back to Manage');
      check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
      check([...document.querySelectorAll('.manage button,.manage select')].every(e=>e.getBoundingClientRect().height>=44),'44px controls');
      check(errors.length===0,'console/runtime errors');
      await click('Profiles2 profiles reported by this gateway');edit('Never restore this review');await tick();await click('Review description change');
      const beforeScopeSwitch=writes();
      const otherClient={...client,url:'https://other-gateway.example.invalid'};
      root.render(<Manage {...props} client={otherClient} conn={{...props.conn,id:'other',url:otherClient.url,label:'Other gateway'}}/>);await tick();
      check(document.querySelector('select').value==='','new gateway must clear management profile');
      check(!content().includes('Reviewed description'),'previous gateway details must not leak');
      root.render(<Manage {...props}/>);await tick();
      check(document.querySelector('select').value==='research','returning gateway restores only its selected profile');
      check(document.querySelector('textarea')?.value==='Reviewed description','returning gateway restores page and refetches data');
      check(!document.querySelector('dialog[open]'),'review token must not survive gateway change');
      check(writes()===beforeScopeSwitch,'scope navigation must not write');
      await click('Back to Manage');
      if (${JSON.stringify(process.env.MANAGEMENT_VIEW || '')}==='confirmation') {await click('Profiles2 profiles reported by this gateway');edit('A second reviewed description');await tick();await click('Review description change');}
      const result=document.createElement('output');result.id='management-browser-result';result.hidden=true;result.textContent='PASS '+innerWidth;document.body.append(result);
    }
    run().catch(e=>{const result=document.createElement('output');result.id='management-browser-result';result.textContent='FAIL '+e.message;document.body.append(result);});
  `;
  const bundle = join(temp, 'fixture.js');
  buildSync({ stdin: { contents: fixture, resolveDir: app, loader: 'tsx' }, outfile: bundle, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
  const theme = readFileSync(join(app, 'src/theme.css'), 'utf8');
  writeFileSync(join(temp, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${theme} html,body{height:auto;overflow:visible} #root{padding:20px;max-width:760px;margin:auto;height:auto}</style><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  // Headless Chrome clamps desktop windows to 500px. Use CDP mobile metrics
  // over anonymous pipes, not a debugging port or an approximate narrow div.
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', `--user-data-dir=${join(temp,'chrome')}`, '--remote-debugging-pipe'], {stdio:['ignore','ignore','ignore','pipe','pipe']});
  let nextId = 0, buffer = '';
  const pending = new Map();
  chrome.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end=buffer.indexOf('\0')) >= 0) {
      const raw=buffer.slice(0,end); buffer=buffer.slice(end+1);
      if (!raw) continue;
      const frame=JSON.parse(raw), call=pending.get(frame.id);
      if (call) { pending.delete(frame.id); clearTimeout(call.timer); if(frame.error)call.reject(new Error(frame.error.message));else call.resolve(frame.result); }
    }
  });
  chrome.on('error', error => { for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);} pending.clear(); });
  const send = (method, params={}, sessionId) => new Promise((resolve,reject)=>{
    const id=++nextId;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15_000);
    pending.set(id,{resolve,reject,timer});
    chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
  try {
    for (const width of [360,390,430]) {
      const {targetId}=await send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true},sessionId);
      await send('Page.navigate',{url:pathToFileURL(join(temp,'index.html')).href},sessionId);
      const evaluated=await send('Runtime.evaluate',{expression:`new Promise(resolve=>{let tries=0;const tick=()=>{const result=document.getElementById('management-browser-result');if(result)return resolve(result.textContent);if(++tries>250)return resolve('fixture did not complete');setTimeout(tick,40);};tick();})`,awaitPromise:true,returnByValue:true},sessionId);
      const result=evaluated.result?.value;
      assert.equal(result,`PASS ${width}`,`browser ${width}: ${result}`);
      if(width===390&&process.env.MANAGEMENT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.MANAGEMENT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      console.log(`management browser: ${width}×844 real component, confirmation/cancel, scope, reads, boundaries and 44px controls PASS`);
      await send('Target.closeTarget',{targetId});
    }
  } finally {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited=new Promise(resolve=>chrome.once('exit',resolve));
      await send('Browser.close').catch(()=>chrome.kill('SIGTERM'));
      const killTimer=setTimeout(()=>chrome.kill('SIGKILL'),3000);
      await exited;clearTimeout(killTimer);
    }
    for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Browser closed'));}pending.clear();
  }
}
