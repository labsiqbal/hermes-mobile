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
  const { canonicalChats, uniqueChats, chatKey, orderedProjects, preferenceKey } = await import(pathToFileURL(join(out,'module.mjs')));
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
  console.log('chat browser identity/preferences: 9 assertions PASS');
} finally { rmSync(out,{recursive:true,force:true}); }
