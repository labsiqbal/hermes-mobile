#!/usr/bin/env node
/** Real component render/layout checks, NOT authenticated runtime parity.
 * Chrome runs disposable file fixtures: no gateway, server, or stored credentials.
 */
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const app = fileURLToPath(new URL('..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'hermes-shell-render-'));
const bundle = join(out, 'render.cjs');
buildSync({stdin:{contents:`
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import Header from './src/components/Header';
  import TabBar from './src/components/TabBar';
  import Connections from './src/screens/Connections';
  import Home from './src/screens/Home';
  import ChatView from './src/screens/ChatView';
  import {ConversationViews} from './src/lib/shell-state';
  const conn = {id:'fixture', label:'Fixture gateway', url:'https://fixture.example.invalid', username:'', password:''};
  const emptyStore = {list:()=>[]};
  const store = {list:()=>[conn]};
  const no = () => {};
  const mode = process.argv[2];
  const header = <Header title="Hermes" subtitle="Fixture gateway / default" state="closed" />;
  const view = mode === 'login'
    ? <div className="screen">{header}<div className="shell-body shell-detail"><Connections store={emptyStore} onConnect={no}/></div></div>
    : mode === 'chat'
    ? <ChatView conn={conn} client={{}} session={null} state="closed" onBack={no} onNewChat={no} onWorkspace={no} viewKey="fixture" views={new ConversationViews()} />
    : <div className="screen">{header}<div className="shell-body"><Home store={store} conn={conn} client={{}} state="closed" onConnect={no} onOpenSession={no} onManageDevices={no}/></div><TabBar active="home" onNavigate={no}/></div>;
  process.stdout.write(renderToStaticMarkup(view));
`,resolveDir:app, loader:'tsx'}, outfile:bundle, bundle:true, platform:'node', format:'cjs', jsx:'automatic', loader:{'.css':'empty'}, define:{'import.meta.glob':'__fixtureGlob'}, banner:{js:'const __fixtureGlob = () => ({});'}, logLevel:'silent'});
const css = readFileSync(join(app, 'src/theme.css'),'utf8') + '\n' + readFileSync(join(app, 'src/screens/chat-view.css'),'utf8');
let assertions = 0;
for (const mode of ['login', 'home', 'chat']) {
  const markup = execFileSync(process.execPath, [bundle, mode], {encoding:'utf8'});
  assert.ok(markup.includes('Disconnected'), 'offline status is derived from actual ConnectionState'); assertions++;
  if (mode === 'home') {
    const labels = [...markup.matchAll(/<span>(Home|Chats|Bots|Activity|Manage)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(labels, ['Home','Chats','Bots','Activity','Manage']); assertions++;
  }
  const html = join(out, mode + '.html');
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${css}</style></head><body><div id="root">${markup}</div><script>
    const controls = [...document.querySelectorAll('button,[role="button"],input:not([type="file"]),textarea')].filter(el => el.getClientRects().length);
    const metrics = {width:innerWidth, height:innerHeight, overflow:document.documentElement.scrollWidth > innerWidth, tiny:controls.filter(el => { const r=el.getBoundingClientRect();return r.width < 43.9 || r.height < 43.9; }).map(el => ({label:el.getAttribute('aria-label')||el.textContent, width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height})), bodies:[...document.querySelectorAll('.body')].map(el=>({height:el.clientHeight, scrollHeight:el.scrollHeight}))};
    const output=document.createElement('pre');output.id='metrics';output.hidden=true;output.textContent=JSON.stringify(metrics);document.body.append(output);
  </script></body></html>`);
  for (const [width,height] of [[320,844],[360,844],[390,844],[430,844],[844,390]]) {
    const args = ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run',`--user-data-dir=${join(out, 'chrome')}`,`--window-size=${width},${height}`,'--force-device-scale-factor=1','--dump-dom',`file://${html}`];
    const dom = execFileSync(process.env.CHROME_BIN || 'google-chrome', args, {encoding:'utf8', timeout:30000, stdio:['ignore','pipe','ignore']});
    const metrics = JSON.parse(dom.match(/<pre id="metrics" hidden="">(.*?)<\/pre>/s)?.[1] || 'null');
    assert.ok(metrics, `${mode}: Chrome returned metrics`);
    assert.equal(metrics.overflow, false, `${mode} ${width}: horizontal overflow`);
    assert.deepEqual(metrics.tiny, [], `${mode} ${width}: controls must be 44px`);
    assert.ok(metrics.bodies.every(body => body.height > 0), `${mode}: body remains scrollable`);
    assertions += 4;
  }
}
console.log(`shell render check: PASS (${assertions} assertions; real SSR component layouts, 320/360/390/430 portrait + landscape outer windows). Fixtures: ${out}`);
