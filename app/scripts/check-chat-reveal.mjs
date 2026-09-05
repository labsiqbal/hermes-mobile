#!/usr/bin/env node
/** Real ChatView + Markdown in Chrome, fictional in-memory client, controlled RAF.
 * No gateway calls, installs, server, or timing-based animation waits.
 * Run: node scripts/check-chat-reveal.mjs
 */
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromePipe } from './production-browser-chrome-pipe.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'hm-chat-reveal-'));
const result = buildSync({
  stdin: { resolveDir: app, loader: 'tsx', contents: `
    import React, {act} from 'react';
    import {createRoot} from 'react-dom/client';
    import ChatView from './src/screens/ChatView';
    import {ConversationViews} from './src/lib/shell-state';
    import {recordSessionEvent} from './src/lib/active-sessions';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const frames = new Map();
    let frameId = 0;
    window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = id => frames.delete(id);
    let root, handlers = new Set(), ready, historyReads = 0;
    const conn = {id:'reveal-fixture', label:'Fictional gateway', url:'https://fixture.invalid'};
    const text = 'Restored answer with a long body. '.repeat(90) + 'FINAL HISTORY MARKER';
    const cached = 'Cached partial answer. '.repeat(20) + 'CACHE MARKER';
    const live = 'Live streaming answer. '.repeat(20) + 'LIVE MARKER';
    const final = 'Authoritative completion replaces the partial. '.repeat(20) + 'FINAL MARKER';
    const message = (type, value = '') => ({type, session_id:'fixture-session', payload:{text:value}});
    const snapshot = () => ({
      bubbles:[...document.querySelectorAll('.bubble-bot')].map(el => {
        const copy = el.cloneNode(true); copy.querySelectorAll('.stream-cursor').forEach(el => el.remove());
        return copy.textContent.trim();
      }),
      entering:document.querySelectorAll('.msg-enter').length,
      frames:frames.size, ready, historyReads,
      text:document.body.textContent,
    });
    window.fixture = {
      text, cached, live, final, snapshot,
      async mount(mode) {
        if (root) await act(async () => root.unmount());
        handlers = new Set(); frames.clear(); localStorage.clear(); ready = null; historyReads = 0;
        const messages = mode === 'history' || mode === 'envelope' ? [{role:'assistant', text}] : [];
        const room = {id:'fixture-room', name:'Fixture group', members:[], log:[{kind:'member', name:'fixture-bot', text}]};
        const client = {
          replayGeneration:0,
          resumeSession:async () => ({session_id:'fixture-session', messages, running:mode === 'cached' || mode === 'inflight',
            ...(mode === 'inflight' ? {inflight:{assistant:cached}} : {}), message_count:mode === 'persisted-count' ? 1 : 0, info:{profile_name:'default'}}),
          sessionMessages:async () => { historyReads++; const rows = mode === 'persisted-count' ? [{role:'assistant',text}] : messages; return {messages:rows, pagination:{returned:rows.length, limit:50}}; },
          pendingApprovals:async () => [],
          addEventHandler:handler => { handlers.add(handler); return () => handlers.delete(handler); },
          profilesList:async () => [{name:'default', is_default:true, ui_meta:{'hermes-bots-groups':{rooms:{'id:fixture-room':room}}}}],
        };
        if (mode === 'cached') {
          recordSessionEvent(client, message('message.start'), 0);
          recordSessionEvent(client, message('message.delta', cached), 0);
        }
        root = createRoot(document.getElementById('root'));
        await act(async () => root.render(<ChatView conn={conn} client={client}
          session={{id:'fixture-session', title:'Fixture session', profile:'default', unpersisted:['envelope','fresh','persisted-count'].includes(mode)}}
          group={mode === 'group' ? {roomId:'fixture-room'} : undefined}
          state="open" onSessionReady={summary => {ready=summary;}} onBack={() => {}} onNewChat={() => {}} viewKey="fixture" views={new ConversationViews()} />));
        return snapshot();
      },
      async emit(type, value) {
        await act(async () => { for (const handler of handlers) handler(message(type, value)); });
        return snapshot();
      },
      async frame() {
        await act(async () => {
          const pending = [...frames.values()]; frames.clear();
          for (const callback of pending) callback(performance.now());
        });
        return snapshot();
      },
      prepareMotion(reduced) {
        const media = matchMedia('(prefers-reduced-motion: reduce)');
        window.preferenceDone = (async () => {
          await act(async () => {
            if (media.matches !== reduced) await new Promise(resolve => media.addEventListener('change', resolve, {once:true}));
          });
        })();
      },
      async unmount() { await act(async () => root.unmount()); },
    };
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: {'.css':'empty'}, define: {'import.meta.glob':'__fixtureGlob', 'process.env.NODE_ENV':'"development"'},
  // Same optional-store fallback as check-shell-render; actual group log renderer is untouched.
  banner: {js:'const __fixtureGlob = () => ({});'}, logLevel:'silent',
});
const html = join(output, 'fixture.html');
writeFileSync(html, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
const browser = new ChromePipe({output, chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const results = [];
async function check(name, run) {
  try { await run(); results.push({name, status:'passed'}); }
  catch (error) { results.push({name, status:'failed', error:error.message}); }
}
const evaluate = expression => browser.evaluate(expression);
const snap = () => evaluate('fixture.snapshot()');
const frame = () => evaluate('fixture.frame()');
const emit = (type, value) => evaluate(`fixture.emit(${JSON.stringify(type)}, ${JSON.stringify(value)})`);
async function motion(reduced) {
  await evaluate(`fixture.prepareMotion(${reduced})`);
  await browser.command('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value:reduced ? 'reduce' : 'no-preference'}]});
  await evaluate('window.preferenceDone');
}
try {
  await browser.start();
  await browser.command('Page.navigate', {url:pathToFileURL(html).href});
  await browser.waitFor('!!window.fixture');
  const {text, cached, live, final} = await evaluate('({text:fixture.text,cached:fixture.cached,live:fixture.live,final:fixture.final})');
  for (const mode of ['history','envelope','cached','inflight','group']) {
    await check(`${mode}: full first paint and every subsequent frame, no reveal scheduled`, async () => {
      const expected = mode === 'cached' || mode === 'inflight' ? cached : text;
      let state = await evaluate(`fixture.mount('${mode}')`);
      assert.deepEqual(state.bubbles, [expected], `${mode}: first paint`);
      assert.equal(state.entering, 0, `${mode}: old content has no entrance animation`);
      for (let i = 0; i < 3; i++) {
        state = await frame();
        assert.deepEqual(state.bubbles, [expected], `${mode}: frame ${i + 1} must never truncate restored content`);
      }
      assert.equal(state.frames, 0, `${mode}: settled/instant text must not schedule reveal RAF`);
    });
  }
  await check('fresh-only hint yields to verified resume count but not an empty resume or error', async () => {
    let state = await evaluate("fixture.mount('fresh')");
    assert.equal(state.historyReads,0); assert.equal(state.ready.unpersisted,true);
    state = await emit('error'); assert.equal(state.ready.unpersisted,true);
    state = await evaluate("fixture.mount('persisted-count')");
    assert.equal(state.historyReads,1); assert.equal(state.ready.unpersisted,false);
    assert.deepEqual(state.bubbles,[text]); assert.deepEqual((await frame()).bubbles,[text]);
    state = await evaluate("fixture.mount('fresh')");
    state = await emit('message.complete',final);
    assert.equal(state.ready.unpersisted,false); assert.equal(state.historyReads,0);
  });
  await check('live delta reveals progressively; completion paints authoritative final immediately', async () => {
    await evaluate("fixture.mount('live')");
    await emit('message.start');
    await emit('message.delta', live);
    const first = (await frame()).bubbles.at(-1);
    assert.ok(first.length > 0 && first.length < live.length, 'actual live text still animates');
    const second = (await frame()).bubbles.at(-1);
    assert.ok(second.length > first.length && live.startsWith(second), 'live reveal advances without changing prefix');
    let state = await emit('message.complete', final);
    assert.deepEqual(state.bubbles, [final], 'completion must flush before another RAF');
    for (let i = 0; i < 3; i++) assert.deepEqual((await frame()).bubbles, [final]);
    assert.equal((await snap()).frames, 0, 'completion cancels reveal RAF');
  });
  await check('cached/inflight restore reveals only newly arriving live suffix, then settles', async () => {
    for (const mode of ['cached', 'inflight']) {
      await evaluate(`fixture.mount('${mode}')`);
      const state = await emit('message.delta', live);
      assert.deepEqual(state.bubbles, [cached], 'cached prefix must remain painted, new suffix starts unrevealed');
      const partial = (await frame()).bubbles.at(-1);
      assert.ok(partial.startsWith(cached) && partial.length > cached.length && partial.length < (cached + live).length);
      assert.deepEqual((await emit('message.complete', final)).bubbles, [final]);
      assert.deepEqual((await frame()).bubbles, [final]);
      assert.equal((await snap()).frames, 0);
    }
  });
  await check('terminal error flushes a partial assistant instead of leaving a live reveal', async () => {
    await evaluate("fixture.mount('live')");
    await emit('message.start');
    await emit('message.delta', live);
    await frame();
    const state = await emit('error');
    assert.equal(state.bubbles[0], live, 'terminal error must paint all received assistant text');
    assert.equal(state.frames, 0, 'terminal error cancels reveal RAF');
    assert.equal(await evaluate("document.querySelectorAll('.stream-cursor').length"), 0);
  });
  await check('completion without preceding delta paints final and remains final', async () => {
    await evaluate("fixture.mount('live')");
    assert.deepEqual((await emit('message.complete', final)).bubbles, [final]);
    assert.deepEqual((await frame()).bubbles, [final]);
    assert.equal((await snap()).frames, 0);
  });
  await check('live reduced-motion preference changes flush and never replay old text', async () => {
    await motion(true);
    await evaluate("fixture.mount('live')");
    await emit('message.start');
    assert.deepEqual((await emit('message.delta', live)).bubbles, [live]);
    assert.equal((await snap()).frames, 0);
    // Flush the actual matchMedia change listener inside act, not a mocked hook.
    await motion(false);
    await frame();
    assert.deepEqual((await snap()).bubbles, [live], 'turning animation back on must not replay the old prefix');
    await emit('message.delta', live);
    const partial = (await frame()).bubbles.at(-1);
    assert.ok(partial.length > live.length && partial.length < (live + live).length, 'new live suffix still animates');
    await motion(true);
    assert.deepEqual((await snap()).bubbles, [live + live]);
    assert.equal((await snap()).frames, 0, 'enabling reduced motion cancels active RAF');
  });
  await evaluate('fixture.unmount()');
} finally {
  await browser.close();
  writeFileSync(join(output, 'report.json'), JSON.stringify({evidence:'REAL-CHATVIEW-FICTIONAL-CLIENT-CONTROLLED-RAF', results, diagnostics:browser.diagnostics, cleanup:browser.cleanup}, null, 2));
}
for (const result of results) console.log(`${result.status.toUpperCase()}: ${result.name}${result.error ? '\n' + result.error : ''}`);
console.log(`Report: ${output}/report.json`);
assert.ok(results.length > 0 && results.every(result => result.status === 'passed'), 'ChatView reveal regressions');
assert.deepEqual(browser.diagnostics, [], 'no browser errors, React act warnings, or network calls');
