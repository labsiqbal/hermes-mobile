#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = mkdtempSync(join(tmpdir(), 'hm-chat-browser-unit-'));
try {
  buildSync({entryPoints:[new URL('../src/lib/chat-browser.ts',import.meta.url).pathname], outfile:join(out,'module.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const { canonicalChats, uniqueChats, chatKey, orderedProjects, preferenceKey, isBotThread, rememberBotThread, readBotThreads } = await import(pathToFileURL(join(out,'module.mjs')));
  const base = {id:'same',title:'Bot Chat',preview:'',started_at:0,message_count:1,source:'cli',profile:'default'};
  const bots = canonicalChats([{name:'builder',canonical_session:{id:'same',resolved_id:'tip',title:'Renamed canonical'}},{name:'default',canonical_session:null}]);
  assert.equal(bots[0].profile,'builder');
  assert.equal(bots[0].bot,true);
  assert.equal(uniqueChats([base,...bots]).length,2);
  assert.equal(uniqueChats([...bots,{...base,id:'tip',profile:'builder'}]).length,1);
  assert.notEqual(chatKey(base),chatKey(bots[0]));
  assert.equal(uniqueChats([base])[0].bot,undefined,'Misleading title is not a bot identity');
  const projects = ['a','b','c'].map(id=>({id}));
  assert.deepEqual(orderedProjects(projects,new Set(['c','b'])).map(p=>p.id),['b','c','a']);
  assert.deepEqual(orderedProjects(projects,new Set(['c'])).map(p=>p.id),['c','a','b']);
  assert.notEqual(preferenceKey({id:'a',url:'https://one.invalid'}),preferenceKey({id:'a',url:'https://two.invalid'}));
  const roster=[{name:'default'},{name:'builder',ui_meta:{'hermes-bots':{handle:'builder'}},canonical_session:{id:'root',resolved_id:'tip'} }];
  assert.equal(isBotThread(base,roster),false,'A Bot Chat title alone must stay ordinary');
  assert.equal(isBotThread({...base,source:'mobile',profile:'builder',title:'Private conversation'},roster),true,'Legacy mobile bot threads belong in Bots');
  assert.equal(isBotThread({...base,profile:'builder'},roster),false,'CLI projects remain ordinary even on a bot profile');
  assert.equal(isBotThread(base,[{name:'default',ui_meta:{'hermes-bots':{groups:['Team']}}}]),false,'Group membership must not move ordinary history');
  assert.equal(isBotThread({...base,source:'bots'},roster),true,'Explicit bot source belongs in Bots');
  assert.equal(isBotThread({...base,id:'tip',profile:'builder'},roster),true,'Canonical continuation belongs in Bots');
  assert.equal(isBotThread(base,roster,new Set([chatKey(base)])),true,'Explicit locally-created bot thread is retained');
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  const conn={id:'storage-test',url:'https://fixture.invalid'};
  rememberBotThread(conn,{...base,resolved_id:'later'});
  assert.equal(isBotThread({...base,id:'later'},roster,readBotThreads(conn)),true,'Storage failure retains created thread and continuation ownership in memory');
  assert.equal(readBotThreads({...conn,url:'https://other.invalid'}).size,0,'Volatile ownership cannot cross gateways');
  console.log('chat browser identity/preferences: PASS');
} finally { rmSync(out,{recursive:true,force:true}); }
