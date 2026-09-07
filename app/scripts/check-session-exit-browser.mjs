#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromePipe } from './production-browser-chrome-pipe.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'hm-session-exit-'));
const bundle = buildSync({
  stdin: {
    resolveDir: app,
    loader: 'tsx',
    contents: `
      import React, {act} from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatView from './src/screens/ChatView';
      import {ConversationViews} from './src/lib/shell-state';
      import {HermesConnection} from './src/lib/hermes-client';
      globalThis.IS_REACT_ACT_ENVIRONMENT=true;
      const frames=new Map(); let frameId=0;
      window.requestAnimationFrame=callback=>{frames.set(++frameId,callback);return frameId;};
      window.cancelAnimationFrame=id=>frames.delete(id);
      const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,0));const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(performance.now());await new Promise(resolve=>setTimeout(resolve,0));};
      const runtime='runtime-builder-42', stored='stored-builder-99', profile='builder';
      const trace=[], views=new ConversationViews(), conn={id:'qa-gateway',label:'QA',url:'https://qa.invalid'};
      let root, client, options={}, ready=[], state='open', openRelease, detachRelease, approvalRelease, closeOperation;
      const base={replayGeneration:0,sessionMessages:async()=>({messages:[{role:'assistant',content:'retained history'}],pagination:{returned:1,limit:100}}),pendingApprovals:async()=>[],addEventHandler:()=>()=>{}};
      const groupRoom={roomId:'fixture-group',name:'Fixture group',members:[],log:[],revision:1};
      function makeClient(next){return {...base,
        profilesList:async()=>next.group?[{name:'default',is_default:true,ui_meta:{'hermes-bots-groups':{rooms:{'id:fixture-group':groupRoom}}}}]:[],
        pendingApprovals:async()=>{if(next.pendingHold)return await new Promise(resolve=>approvalRelease=()=>resolve(next.pending??[]));if(next.pendingError)throw Error(next.pendingError);return next.pending||[];},
        resumeSession:async(sid,opts)=>{trace.push({method:'session.resume',sid,opts});if(next.openHold) await new Promise(resolve=>openRelease=resolve);return {session_id:runtime,stored_session_id:stored,messages:[{role:'assistant',content:'retained history'}],message_count:1,info:{profile_name:profile},running:next.running===true,status:next.running?'streaming':'idle'};},
        closeSession:sid=>{trace.push({method:'session.close',sid});closeOperation=(async()=>{if(next.hold)return await new Promise(resolve=>window.releaseClose=()=>resolve(next.result??{closed:true}));if(next.error)throw Error(next.error);return next.result??{closed:true};})();return closeOperation;},
        detachImage:async(sid,path)=>{trace.push({method:'image.detach',sid,path});if(next.detachHold)return await new Promise(resolve=>detachRelease=resolve);if(next.detachError)throw Error(next.detachError);return {detached:true};},
        submitPrompt:async(sid,text)=>{trace.push({method:'prompt.submit',sid,text});return {status:'streaming'};},
        steerSession:async(sid,text)=>{trace.push({method:'session.steer',sid,text});return {status:'streaming'};},
        modelOptions:async sid=>{trace.push({method:'model.options',sid});if(next.modelError)throw Error(next.modelError);return {model:'fixture-model',provider:'fixture',providers:[{slug:'fixture',name:'Fixture',models:['fixture-model']}]};},
        configSet:async(...args)=>{trace.push({method:'config.set',args});return {};},
      };}
      async function render(){await act(async()=>{root.render(<ChatView conn={conn} client={client} session={options.group?undefined:{id:stored,title:'Fixture',profile}} group={options.group?{roomId:'fixture-group'}:undefined} state={state} onBack={()=>{}} onNewChat={()=>{}} onWorkspace={()=>{}} onSessionReady={x=>ready.push(x)} viewKey='fixture' views={views}/>);await settle();});}
      async function mount(next={}){if(root)await act(async()=>root.unmount());options=next;state=next.state||'open';ready=[];closeOperation=undefined;window.releaseClose=undefined;if(next.reset!==false)trace.length=0;client=makeClient(next);root=createRoot(document.querySelector('#root'));await render();}
      async function rerender(next={}){state=next.state||state;await render();}
      async function unmount(){await act(async()=>root.unmount());}
      async function type(text,enter=true){const e=document.querySelector('textarea'),set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;await act(async()=>{e.focus();set.call(e,text);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));await settle();});if(enter)await key('Enter');}
      async function key(key,composing=false){const e=document.querySelector('textarea');await act(async()=>{e.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,isComposing:composing}));await settle();});}
      async function sendTap(){await act(async()=>{document.querySelector('[aria-label="Send message"]')?.click();await Promise.resolve();if(!options.hold)await closeOperation?.catch(()=>{});await settle();});}
      async function slashTap(index=0){await act(async()=>{const option=document.querySelectorAll('#slash-suggestions [role=option]')[index];option?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));option?.click();await settle();});}
      async function steerTap(){await act(async()=>{document.querySelector('[aria-label=' + JSON.stringify('Steer active run') + ']')?.click();await settle();});}
      async function releaseClose(){await act(async()=>{window.releaseClose?.();await closeOperation?.catch(()=>{});await settle();});}
      async function releaseDetach(){await act(async()=>{detachRelease?.();await settle();});}
      async function releaseApprovals(){await act(async()=>{approvalRelease?.();await settle();});}
      async function releaseOpen(){await act(async()=>{openRelease?.();await settle();});}
      async function flush(){await act(async()=>{await settle();});}
      async function nativeClose(){const native=new HermesConnection({url:'https://fixture.invalid'}),calls=[];native.rpc=async(method,params)=>{calls.push({method,params});return {closed:true};};return {calls,result:await native.closeSession(runtime)};}
      async function seedImage(){await act(async()=>{views.update('fixture',{attachments:[{kind:'image',name:'fixture.png',path:'/tmp/fixture.png'}]});await settle();});}
      async function removeImage(){await act(async()=>{document.querySelector('[aria-label="Remove fixture.png"]')?.click();await settle();});}
      window.fixture={mount,rerender,unmount,type,key,sendTap,slashTap,steerTap,releaseClose,releaseDetach,releaseApprovals,releaseOpen,flush,nativeClose,seedImage,removeImage,trace:()=>trace.slice(),status:()=>({text:document.body.innerText,disabled:document.querySelector('textarea')?.disabled,value:document.querySelector('textarea')?.value,focused:document.activeElement===document.querySelector('textarea'),history:document.body.innerText.includes('retained history'),ready:ready.slice(),slash:[...document.querySelectorAll('#slash-suggestions [role=option]')].map(x=>({text:x.textContent,height:x.getBoundingClientRect().height,selected:x.getAttribute('aria-selected')})),workspaceDisabled:[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Workspace'))?.disabled})};
    `,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'import.meta.glob': '__fixtureGlob', 'process.env.NODE_ENV': '"development"' },
  banner: { js: 'const __fixtureGlob=()=>({});' }, logLevel: 'silent',
});
const html = join(output, 'fixture.html');
const css = readFileSync(join(app, 'src/screens/chat-view.css'), 'utf8');
writeFileSync(html, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
const browser = new ChromePipe({ output, chrome: process.env.CHROME_BIN || '/usr/bin/google-chrome' });
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: 'passed' }); }
  catch (error) { checks.push({ name, status: 'failed', error: error.stack }); }
}
try {
  await browser.start();
  await browser.command('Page.navigate', { url: pathToFileURL(html).href });
  await browser.waitFor('!!window.fixture');
  const run = expression => browser.evaluate(expression);

  await check('exact /exit closes current runtime, retains stored profile/history, clears only exact draft', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    assert.deepEqual(await run('fixture.trace()'), [
      { method: 'session.resume', sid: 'stored-builder-99', opts: { omitMessages: true, profile: 'builder' } },
      { method: 'session.close', sid: 'runtime-builder-42' },
    ]);
    const view = await run('fixture.status()');
    assert.equal(view.history, true);
    assert.equal(view.disabled, true);
    assert.equal(view.workspaceDisabled, true);
    assert.equal(view.value, '');
    assert.match(view.text, /Session closed in Mobile/);
    assert.equal(view.ready.at(-1).resolved_id, 'stored-builder-99');
    assert.equal(view.ready.at(-1).profile, 'builder');
  });

  await check('native HermesConnection close wrapper sends session.close wire contract', async () => {
    assert.deepEqual(await run('fixture.nativeClose()'), { calls: [{ method: 'session.close', params: { session_id: 'runtime-builder-42' } }], result: { closed: true } });
  });

  await check('same mounted disconnected then reopened client does not resume released runtime twice', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    await run("fixture.rerender({state:'closed'})");
    await run("fixture.rerender({state:'open'})");
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'session.resume').length, 1);
    assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
  });

  await check('image detach blocks /exit until gateway staging settles', async () => {
    await run('fixture.seedImage()');
    await run('fixture.mount({detachHold:true})');
    await run('fixture.removeImage()');
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'image.detach').length, 1);
    assert.equal(wire.filter(x => x.method === 'session.close').length, 0);
    const view = await run('fixture.status()');
    assert.equal(view.workspaceDisabled, false);
    assert.match(view.text, /Exit unavailable while session is busy/);
    await run('fixture.releaseDetach()');
  });

  await check('explicit unmount/reopen after /exit resumes stored ID and profile with retained history', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    await run('fixture.unmount()');
    await run('fixture.mount({reset:false})');
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
    const resumes = wire.filter(x => x.method === 'session.resume');
    assert.equal(resumes.length, 2);
    assert.deepEqual(resumes.map(x => [x.sid, x.opts]), [
      ['stored-builder-99', { omitMessages: true, profile: 'builder' }],
      ['stored-builder-99', { omitMessages: true, profile: 'builder' }],
    ]);
    const view = await run('fixture.status()');
    assert.equal(view.history, true);
    assert.equal(view.ready.at(-1).resolved_id, 'stored-builder-99');
    assert.equal(view.ready.at(-1).profile, 'builder');
  });

  await check('uncertain close freezes runtime and ordinary send makes no prompt or retry', async () => {
    for (const scenario of [{ result: { closed: false } }, { result: {} }, { error: 'fixture timeout' }]) {
      await run(`fixture.mount(${JSON.stringify(scenario)})`);
      await run("fixture.type('/exit',false)");
      await run('fixture.sendTap()');
      await run("fixture.type('ordinary send')");
      const view = await run('fixture.status()');
      const wire = await run('fixture.trace()');
      assert.equal(view.disabled, true);
      assert.match(view.text, /Close outcome uncertain/);
      assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
      assert.equal(wire.filter(x => x.method === 'prompt.submit').length, 0);
    }
  });

  await check('pending close blocks attempted ordinary send with no prompt', async () => {
    await run('fixture.mount({hold:true})');
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    await run("fixture.type('ordinary send')");
    let wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
    assert.equal(wire.filter(x => x.method === 'prompt.submit').length, 0);
    const view = await run('fixture.status()');
    assert.equal(view.disabled, true);
    assert.equal(view.workspaceDisabled, true);
    await run('fixture.releaseClose()');
    wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
  });

  await check('pending initialization does not close', async () => {
    await run('fixture.mount({openHold:true})');
    await run("fixture.type('/exit')");
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
    await run('fixture.releaseOpen()');
  });

  await check('busy keyboard and steer routes refuse exact exit without close', async () => {
    await run('fixture.mount({running:true})');
    await run("fixture.type('/exit',false)");
    await run("fixture.key('Enter')");
    await run("fixture.key('Enter')");
    assert.match((await run('fixture.status()')).text, /Exit unavailable while session is busy/);
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
    await run('fixture.steerTap()');
    assert.match((await run('fixture.status()')).text, /Exit unavailable while session is busy/);
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
  });

  await check('disconnected, arguments, and group exit refuse locally with no production RPC', async () => {
    await run("fixture.mount({state:'closed'})");
    await run("fixture.type('/exit')");
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
    await run('fixture.mount()');
    await run("fixture.type('/exit --delete')");
    assert.equal((await run('fixture.trace()')).filter(x => ['session.close', 'prompt.submit', 'session.steer', 'slash.exec', 'session.delete'].includes(x.method)).length, 0);
    assert.match((await run('fixture.status()')).text, /does not accept arguments/);
    await run('fixture.mount({group:true})');
    await run("fixture.type('/exit')");
    assert.equal((await run('fixture.trace()')).filter(x => ['session.close', 'prompt.submit', 'session.steer'].includes(x.method)).length, 0);
    assert.match((await run('fixture.status()')).text, /unavailable in group chats/);
  });

  await check('slash palette shows commands, supports pointer/arrows/Escape/IME, and only Send executes', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/',false)");
    let view = await run('fixture.status()');
    assert.equal(view.slash.length, 2);
    assert.deepEqual(view.slash.map(x => x.text.startsWith('/exit') || x.text.startsWith('/model')), [true, true]);
    assert.ok(view.slash.every(x => x.height >= 44));
    await run("fixture.key('ArrowDown')");
    assert.equal((await run('fixture.status()')).slash[1].selected, 'true');
    await run("fixture.key('Escape')");
    assert.equal((await run('fixture.status()')).slash.length, 0);
    await run("fixture.type('/ex',false)");
    await run('fixture.slashTap()');
    view = await run('fixture.status()');
    assert.equal(view.value, '/exit');
    assert.equal(view.focused, true);
    assert.equal((await run('fixture.trace()')).filter(x => x.method !== 'session.resume').length, 0);
    await run('fixture.sendTap()');
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'session.close').length, 1);
    assert.equal(wire.filter(x => ['prompt.submit', 'session.steer'].includes(x.method)).length, 0);

    await run('fixture.mount()');
    await run("fixture.type('/ex',false)");
    await run("fixture.key('Enter')");
    assert.equal((await run('fixture.status()')).value, '/exit');
    assert.equal((await run('fixture.trace()')).filter(x => x.method !== 'session.resume').length, 0);
  });

  await check('IME Enter leaves slash selection and RPC untouched; ordinary text still sends', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/ex',false)");
    await run("fixture.key('Enter',true)");
    assert.equal((await run('fixture.status()')).value, '/ex');
    assert.equal((await run('fixture.trace()')).filter(x => x.method !== 'session.resume').length, 0);
    await run('fixture.mount()');
    await run("fixture.type('ordinary text',false)");
    await run("fixture.key('Enter')");
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'prompt.submit' && x.text === 'ordinary text').length, 1);
  });

  await check('/model opens model sheet without config write, retains draft when catalog fails, and never opens while streaming', async () => {
    await run('fixture.mount({running:true})');
    await run("fixture.type('/model',false)");
    await run("fixture.key('Enter')");
    await run("fixture.key('Enter')");
    await run('fixture.steerTap()');
    let wire = await run('fixture.trace()');
    assert.match((await run('fixture.status()')).text, /\/model is unavailable while a run is active/);
    assert.equal(wire.filter(x => x.method === 'model.options').length, 0);
    assert.equal(wire.filter(x => x.method === 'session.steer').length, 0);

    await run('fixture.mount({modelError:"catalog unavailable"})');
    await run("fixture.type('/model',false)");
    await run('fixture.sendTap()');
    let view = await run('fixture.status()');
    wire = await run('fixture.trace()');
    assert.equal(view.value, '/model');
    assert.match(view.text, /catalog unavailable/);
    assert.deepEqual(wire.filter(x => x.method === 'model.options'), [{ method: 'model.options', sid: 'runtime-builder-42' }]);
    assert.equal(wire.filter(x => x.method === 'config.set').length, 0);
    await run('fixture.mount()');
    await run("fixture.type('/model',false)");
    await run('fixture.sendTap()');
    view = await run('fixture.status()');
    assert.match(view.text, /fixture-model/);
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'config.set').length, 0);
    await run("fixture.mount({state:'closed'})");
    await run("fixture.type('/model',false)");
    await run('fixture.sendTap()');
    assert.equal((await run('fixture.status()')).value, '/model');
  });

  await check('bare slash never sends or steers', async () => {
    await run('fixture.mount()');
    await run("fixture.type('/',false)");
    await run('fixture.sendTap()');
    assert.match((await run('fixture.status()')).text, /Unknown command: \//);
    await run('fixture.mount({running:true})');
    await run("fixture.type('/',false)");
    await run('fixture.steerTap()');
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => ['prompt.submit', 'session.steer'].includes(x.method)).length, 0);
  });

  await check('unknown hyphen and underscore commands never send or steer; absolute paths remain text', async () => {
    await run('fixture.mount()');
    for (const command of ['/foo-bar', '/skill_name', '/foo2']) {
      await run(`fixture.type(${JSON.stringify(command)},false)`);
      await run('fixture.sendTap()');
      assert.match((await run('fixture.status()')).text, /Unknown command/);
    }
    await run("fixture.type('/path/to/file',false)");
    await run('fixture.sendTap()');
    const wire = await run('fixture.trace()');
    assert.equal(wire.filter(x => x.method === 'prompt.submit' && x.text === '/path/to/file').length, 1);

    await run('fixture.mount({running:true})');
    for (const command of ['/foo-bar', '/skill_name', '/model']) {
      await run(`fixture.type(${JSON.stringify(command)},false)`);
      await run('fixture.steerTap()');
    }
    await run('fixture.flush()');
    const busyWire = await run('fixture.trace()');
    assert.equal(busyWire.filter(x => ['prompt.submit', 'session.steer'].includes(x.method)).length, 0);
  });

  await check('rejected approval lookup blocks explicit exit with no close', async () => {
    await run('fixture.mount({pendingError:"approval lookup rejected"})');
    assert.equal((await run('fixture.status()')).history, true);
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    assert.match((await run('fixture.status()')).text, /approval state could not be verified/);
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
  });

  await check('deferred approval lookup blocks explicit exit, then release permits one close', async () => {
    await run('fixture.mount({pendingHold:true})');
    assert.equal((await run('fixture.status()')).history, true);
    await run("fixture.type('/exit',false)");
    await run('fixture.sendTap()');
    assert.match((await run('fixture.status()')).text, /approval state is loading/);
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 0);
    await run('fixture.releaseApprovals()');
    await run('fixture.sendTap()');
    assert.equal((await run('fixture.trace()')).filter(x => x.method === 'session.close').length, 1);
  });
} finally {
  await browser.close();
  writeFileSync(join(output, 'report.json'), JSON.stringify({ evidence: 'REAL-CHATVIEW-BUILT-BROWSER-FICTIONAL-RPC', checks, diagnostics: browser.diagnostics, cleanup: browser.cleanup }, null, 2));
}
for (const result of checks) console.log(`${result.status.toUpperCase()}: ${result.name}${result.error ? `\n${result.error}` : ''}`);
console.log(`Report: ${output}/report.json`);
assert.ok(checks.length && checks.every(x => x.status === 'passed'), 'session exit browser regressions');
assert.deepEqual(browser.diagnostics, []);
