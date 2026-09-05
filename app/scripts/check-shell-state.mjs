#!/usr/bin/env node
// Approved seam: pure navigation identity/history and conversation view state.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { unlinkSync } from 'node:fs';
const outfile = join(tmpdir(), `shell-state-${process.pid}.mjs`);
buildSync({entryPoints:[fileURLToPath(new URL('../src/lib/shell-state.ts', import.meta.url))], outfile, bundle:true, format:'esm', platform:'node', logLevel:'silent'});
const { ShellNavigation, conversationKey, ConversationViews, ManageViews, isAppStorageKey } = await import(pathToFileURL(outfile).href);
unlinkSync(outfile);
class History {
  entries = [null]; index = 0;
  get state() { return this.entries[this.index]; }
  replaceState(value) { this.entries[this.index] = structuredClone(value); }
  pushState(value) { this.entries.splice(++this.index, Infinity, structuredClone(value)); }
  back() { if (this.index) this.index--; }
  forward() { if (this.index + 1 < this.entries.length) this.index++; }
}
const history = new History();
const nav = new ShellNavigation(history);
const gateway = { id:'atlas', url:'https://atlas.tailnet.ts.net' };
nav.go({screen:'chats', gateway, profile:'studio'});
const project = {screen:'chat', gateway, profile:'studio', conversation:{id:'project', session:{id:'project', profile:'studio'}}, returnTo:'chats'};
nav.go(project);
nav.go({...project, screen:'workspace'});
nav.back(); nav.restore();
assert.equal(nav.current.screen, 'chat');
assert.equal(nav.current.conversation.id, 'project');
nav.back(); nav.restore();
assert.equal(nav.current.screen, 'chats');
history.forward(); nav.restore();
assert.equal(nav.current.conversation.id, 'project', 'Forward must restore the conversation, not last opened chat');
nav.go({screen:'bots', gateway, profile:'studio'});
const bot = {...project, profile:'research', conversation:{id:'mira', session:{id:'mira', profile:'research'}}, returnTo:'bots'};
nav.go(bot);
nav.back(); nav.restore();
assert.equal(nav.current.screen, 'bots');
nav.back(); nav.restore();
assert.equal(nav.current.conversation.id, 'project');
assert.equal(nav.current.profile, 'studio');
const secondGateway = {...project, gateway:{id:'harbor', url:'https://harbor.tailnet.ts.net'}};
nav.go(secondGateway);
nav.back(); nav.restore();
assert.equal(nav.current.gateway.id, 'atlas');
history.forward(); nav.restore();
assert.equal(nav.current.gateway.id, 'harbor');
const direct = new History();
direct.replaceState({shell:1, depth:0, route:{...project, screen:'workspace'}});
const directNav = new ShellNavigation(direct);
for (const target of ['chat', 'chats', 'home', 'home']) {
  directNav.back();
  assert.equal(directNav.current.screen, target);
  assert.equal(direct.entries.length, 1, 'synthetic Back must replace, never push');
}
const views = new ConversationViews();
const pk = conversationKey(project), bk = conversationKey(bot);
views.update(pk, {draft:'Project draft', scroll:{top:281, atBottom:false}, attachments:[{kind:'image', name:'shot.png', path:'/staged/image'}]});
views.update(bk, {draft:'Bot draft'});
assert.equal(views.read(pk).draft, 'Project draft');
assert.deepEqual(views.read(pk).scroll, {top:281, atBottom:false});
assert.equal(views.read(bk).draft, 'Bot draft');
assert.equal(views.read(conversationKey(secondGateway)).draft, '');
assert.equal(views.read(conversationKey({...project, profile:'research'})).draft, '');
assert.equal(views.read(conversationKey({...project, gateway:{...gateway, url:'https://replacement.tailnet.ts.net'}})).draft, '');
views.update(pk, {draft:''});
assert.equal(views.read(pk).draft, '');
assert.equal(views.read(bk).draft, 'Bot draft');
assert.equal(views.read(pk).attachments[0].name, 'shot.png');
assert.notEqual(conversationKey({...project, profile:'a/b', conversation:{id:'c', session:null}}), conversationKey({...project, profile:'a', conversation:{id:'b/c', session:null}}));
for (const key of ['hermes-mobile.connections.v1', 'hermes-mobile.rooms.v1', 'hermes-mobile.active-sessions.v2', 'hermes-projects-expanded:atlas']) assert.equal(isAppStorageKey(key), true);
for (const key of ['other-app.token', 'hermes-desktop.settings', 'hermes-mobile-unrelated', 'token']) assert.equal(isAppStorageKey(key), false);
const unsafeGateway = {...gateway, username:'fixture-user', password:'fixture-secret'};
nav.go({...project, gateway:unsafeGateway});
assert.equal(JSON.stringify(history.state).includes('fixture-secret'), false, 'history must discard credentials even from structurally compatible objects');
const broken = new History();
broken.replaceState({shell:1, depth:0, route:{...project, profile:'wrong-owner'}});
assert.equal(new ShellNavigation(broken).current.screen, 'home', 'reject a mismatched history profile rather than opening it');
const created = {...project, conversation:{id:'draft:uuid', session:null}};
const durable = {...project, conversation:{id:'durable', session:{id:'durable', resolved_id:'continuation'}}};
const resolved = {...durable, conversation:{...durable.conversation, id:'continuation'}};
const ck = conversationKey(created), dk = conversationKey(durable), rk = conversationKey(resolved);
views.update(ck, {draft:'created draft'}); views.link(ck, dk); views.link(dk, rk);
views.update(ck, {draft:'latest draft'});
for (const k of [ck,dk,rk]) assert.equal(views.read(k).draft, 'latest draft');
views.link(rk,ck); // repeated verification cannot introduce an alias cycle
for (const scope of [{...durable, profile:'other'}, {...durable, gateway:{...gateway,id:'other'}}, {...durable, gateway:{...gateway,url:'https://other.invalid'}}]) assert.equal(views.read(conversationKey(scope)).draft, '');
const manage = new ManageViews();
manage.update(gateway, {page:'settings', profile:'qa-bot', review:{token:'never retain'}, approval:'never retain'});
assert.deepEqual(manage.read(gateway), {page:'settings',profile:'qa-bot'});
for (const other of [{...gateway,id:'other'}, {...gateway,url:'https://other.invalid'}]) assert.deepEqual(manage.read(other), {page:'hub',profile:''});
console.log('shell state check: PASS (Back/Forward, gateway/profile/session isolation, replacement fallback, drafts/scroll/attachments, scoped wipe)');
