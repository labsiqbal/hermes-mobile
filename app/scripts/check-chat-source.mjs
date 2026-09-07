#!/usr/bin/env node
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=mkdtempSync(join(tmpdir(),'hm-chat-source-'));let checks=0;
const test=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
try {
 buildSync({stdin:{contents:"export {ChatSource} from './src/lib/chat-source';export {ManagementClient,ManagementError} from './src/lib/management-client';export {HermesConnection,RpcError} from './src/lib/hermes-client';export {isAppStorageKey} from './src/lib/shell-state';export {preferenceKey} from './src/lib/chat-browser';export {absolutePathCompletions,isSessionNotOwned,pathCompletionContext,safeServerFolder} from './src/screens/ChatView';",resolveDir:new URL('..',import.meta.url).pathname},outfile:join(out,'source.mjs'),bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},define:{'import.meta.glob':'__fixtureGlob'},banner:{js:'const __fixtureGlob = () => ({});'},logLevel:'silent'});
 const {ChatSource,ManagementClient,ManagementError,HermesConnection,RpcError,isAppStorageKey,preferenceKey,absolutePathCompletions,isSessionNotOwned,pathCompletionContext,safeServerFolder}=await import(pathToFileURL(join(out,'source.mjs')));
 const row=(id='same',profile='builder')=>({id,profile,title:'Misleading Bot Chat',preview:'',source:'cli',started_at:1,message_count:1});
 let rows=[row()],current='builder',ack='valid',canonical=null,calls=[];
 const client={url:'https://fixture.invalid',connectionState:'open',profilesList:async()=>[{name:'builder',canonical_session:null},{name:'default',canonical_session:{id:'same'}}],projectTree:async()=>({projects:[],scoped_session_ids:[]}),sessionFindBotChat:async()=>canonical,sessionDelete:async(id,profile)=>{calls.push(['delete',id,profile]);rows=[];return ack==='valid'?{deleted:id}:null;}};
 const manager={runningProfile:async()=>current,sessions:async profile=>profile==='builder'?rows:[],sessionIdentity:async(profile,id)=>{calls.push(['detail',id,profile]);if(!rows.some(r=>r.id===id)) throw new ManagementError('unsupported','Absent','none',404);return {id,profile};}};
 const source=new ChatSource(client,manager),target=row();
 await test('ordinary and canonical owner provenance',async()=>{const data=await source.load();assert.equal(data.sessions[0].profile,'builder');assert.equal(data.bots[0].profile,'default');});
 await test('cancel makes no write',async()=>{await assert.rejects(()=>source.delete(target,false),/confirmation/);assert.equal(calls.length,0);});
 await test('cross-profile deletion unavailable',async()=>{await assert.rejects(()=>source.delete({...target,profile:'default'},true),/running profile/);assert.equal(calls.length,0);});
 await test('canonical marker protection',async()=>{await assert.rejects(()=>source.delete({...target,bot:true},true),/canonical/);});
 await test('null roster canonical uses exact lookup and protects target',async()=>{canonical={id:'same'};await assert.rejects(()=>source.delete(target,true),/canonical/);assert.equal(calls.filter(c=>c[0]==='delete').length,0);canonical=null;});
 await test('failed canonical lookup fails closed',async()=>{const bad=new ChatSource({...client,sessionFindBotChat:async()=>{throw Error('lookup unavailable');}},manager);await assert.rejects(()=>bad.delete(target,true),/lookup unavailable/);assert.equal(calls.filter(c=>c[0]==='delete').length,0);});
 await test('confirmed exact-owner deletion acknowledgment plus exact readback',async()=>{calls=[];await source.delete(target,true);assert.deepEqual(calls,[['detail','same','builder'],['delete','same','builder'],['detail','same','builder']]);});
 await test('malformed acknowledgment means unknown',async()=>{rows=[target];ack='invalid';await assert.rejects(()=>source.delete(target,true),/outcome is unknown/);ack='valid';});
 await test('readback failure means unknown, not success',async()=>{rows=[target];const bad=new ChatSource({...client,sessionDelete:async()=>({deleted:'same'})},manager);await assert.rejects(()=>bad.delete(target,true),/outcome is unknown/);});
 await test('context cancellation during preflight cannot dispatch',async()=>{const controller=new AbortController();calls=[];const bad=new ChatSource(client,{...manager,sessionIdentity:async(profile,id)=>{controller.abort();return {profile,id};}});await assert.rejects(()=>bad.delete(target,true,controller.signal),/confirmation changed/);assert.equal(calls.filter(c=>c[0]==='delete').length,0);});
 await test('disconnected review cannot dispatch',async()=>{client.connectionState='closed';await assert.rejects(()=>source.delete(target,true),/connection/);client.connectionState='open';});
 await test('project failure preserves verified profile history',async()=>{rows=[target];const bad=new ChatSource({...client,projectTree:async()=>{throw Error('unsupported projects');}},manager);const data=await bad.load();assert.deepEqual(data.sessions,[target]);assert.equal(data.warnings.length,2);});
 await test('ownerless project rows are rejected without discarding REST history',async()=>{const bad=new ChatSource({...client,projectTree:async()=>({projects:[{id:'p',sessionCount:1,previewSessions:[{id:'same'}]}]})},manager);const data=await bad.load();assert.equal(data.projects.length,0);assert.equal(data.sessions.length,1);});
 const fetchPage=(fn)=>new ManagementClient(client,async input=>{const url=new URL(input);assert.equal(url.pathname,'/api/sessions');assert.equal(url.searchParams.get('profile'),'builder');return Response.json(fn(Number(url.searchParams.get('offset'))));});
 await test('pinned backfill beyond 100 rows deduplicates across offset pages',async()=>{const batch=Array.from({length:100},(_,i)=>row(String(i)));const pin={...row('old-pin'),pinned:true};const offsets=[];const adapter=fetchPage(offset=>{offsets.push(offset);return {sessions:offset===0?[...batch,pin]:[pin],total:101,limit:100,offset};});assert.equal((await adapter.sessions('builder')).length,101);assert.deepEqual(offsets,[0,100]);});
 await test('hidden roots in total do not invalidate visible results',async()=>{assert.equal((await fetchPage(offset=>({sessions:[row()],total:2,limit:100,offset})).sessions('builder')).length,1);});
 await test('owner echo required for every row including duplicate pin',async()=>{await assert.rejects(()=>fetchPage(offset=>({sessions:[{...row(),profile:'default',pinned:true}],total:1,limit:100,offset})).sessions('builder'),/ownership/);});
 await test('unpinned repeated pages fail visibly',async()=>{await assert.rejects(()=>fetchPage(offset=>({sessions:[row()],total:101,limit:100,offset})).sessions('builder'),/repeated/);});
 await test('changing totals fail visibly',async()=>{await assert.rejects(()=>fetchPage(offset=>({sessions:[row(String(offset))],total:offset?102:101,limit:100,offset})).sessions('builder'),/changed/);});
 await test('scope token is literal, never normalized',async()=>{await assert.rejects(()=>fetchPage(()=>({})).sessions(' Builder '),/identifier/);});
 await test('exact detail narrowly projects secrets',async()=>{const adapter=new ManagementClient(client,async()=>Response.json({...row(),system_prompt:'PRIVATE',model_config:{key:'PRIVATE'}}));assert.deepEqual(await adapter.sessionIdentity('builder','same'),{id:'same',profile:'builder'});});
 await test('literal default serialized for list/tree/project/delete',async()=>{const wire=[];const real=new HermesConnection({url:'https://fixture.invalid',username:'fixture',password:'fictional'});real.rpc=async(method,params)=>{wire.push({method,params});return {};};await real.listSessions({profile:'default'});await real.projectTree(3,'default');await real.projectSessions('p','default');await real.sessionDelete('id','default');assert.ok(wire.every(call=>call.params.profile==='default'));assert.deepEqual(wire.at(-1),{method:'session.delete',params:{session_id:'id',profile:'default'}});});
 await test('ownership retry requires typed SESSION_NOT_OWNED reason, never a similar message',async()=>{assert.equal(isSessionNotOwned(new RpcError(4009,'Session already has a live owner',{reason:'SESSION_NOT_OWNED'})),true);assert.equal(isSessionNotOwned(new RpcError(4009,'Session already has a live owner',{reason:'OTHER'})),false);assert.equal(isSessionNotOwned(new Error('Session already has a live owner')),false);});
 await test('new-session folder accepts root and trailing slash but rejects sensitive paths',async()=>{for(const path of ['/','/workspace/project','/workspace/project/','/home/iqbal/workspace/.worktrees/project/feature'])assert.equal(safeServerFolder(path),true);for(const path of ['','relative','/workspace/../secret','/workspace/%2e%2e/secret','/home/iqbal/.ssh','/workspace/key.pem'])assert.equal(safeServerFolder(path),false);});
 await test('native folder completion uses source-proven folder schema only',async()=>{assert.deepEqual(pathCompletionContext('/fictional/qa'),{word:'@folder:qa',cwd:'/fictional',prefix:'/fictional/'});assert.deepEqual(pathCompletionContext('/'),{word:'@folder:',cwd:'/',prefix:'/'});assert.deepEqual(absolutePathCompletions('/fictional/qa',[{text:'@folder:qa-project'},{text:'qa-readme.md'},{text:'@folder:../escape'},{text:42}]),['/fictional/qa-project/']);assert.equal(pathCompletionContext('/fictional/.ssh'),null);});
 await test('completion adapter accepts native slash folders and rejects malformed rows before UI mapping',async()=>{const real=new HermesConnection({url:'https://fixture.invalid',username:'fixture',password:'fictional'});const wire=[];real.rpc=async(method,params)=>{wire.push({method,params});return{items:[{text:'@folder:project/',display:'project/',meta:'dir'},{text:'@folder:project/nested/',display:'nested/',meta:'dir'},{text:'@folder:../escape/',display:'escape/',meta:'dir'},{text:'@folder:project//',display:'project//',meta:'dir'},{text:'@folder:project/\u0000',display:'project/',meta:'dir'},{text:'plain-file'},{text:42},null]};};assert.deepEqual(await real.completePath('@folder:pro','/workspace'),[{text:'@folder:project/',display:'project/',meta:'dir'}]);assert.deepEqual(wire,[{method:'complete.path',params:{word:'@folder:pro',cwd:'/workspace'}}]);});
 await test('new pin and expansion keys included in existing app-data wipe',async()=>{const key=preferenceKey({id:'x',url:'https://fixture.invalid'});assert.equal(isAppStorageKey(key),true);assert.equal(isAppStorageKey(`${key}:expanded`),true);});
 await test('partial refresh preserves owned history and hydrated rows without stale project membership',async()=>{
  let fail=false;
  const scoped={...client,profilesList:async()=>[{name:'builder'},{name:'default'}],projectSessions:async()=>({id:'p',sessionCount:1,previewSessions:[row('older')]})};
  const reads={...manager,sessions:async profile=>{if(fail&&profile==='builder')throw new ManagementError('network','Read failed.');return [row(fail?'new-default':'initial',profile)];}};
  const cached=new ChatSource(scoped,reads);await cached.load();await cached.project('p','builder');fail=true;
  const next=await cached.load();assert.deepEqual(next.sessions.map(r=>[r.profile,r.id]),[['builder','initial'],['builder','older'],['default','new-default']]);assert.deepEqual(next.failedProfiles,['builder']);assert.equal(next.projects.length,0);
 });
 await test('verified rows from a partial tree failure survive a later list failure',async()=>{
  let step=0;
  const cached=new ChatSource({...client,profilesList:async()=>[{name:'builder'}],projectTree:async()=>{throw Error('PRIVATE_RPC_BODY');}},{...manager,sessions:async()=>{if(step++)throw Error('PRIVATE_NETWORK');return [row('newly-read')];}});
  const first=await cached.load();assert.equal(first.sessions[0].id,'newly-read');assert.ok(!first.warnings.join().includes('PRIVATE'));
  const second=await cached.load();assert.deepEqual(second.sessions,first.sessions);
 });
 await test('successful empty refresh retires cache; removed roster owner cannot revive stale history',async()=>{
  let owners=[{name:'builder'}],empty=false,fail=false;
  const cached=new ChatSource({...client,profilesList:async()=>owners},{...manager,sessions:async()=>{if(fail)throw Error('read failed');return empty?[]:[row()];}});
  await cached.load();empty=true;assert.deepEqual((await cached.load()).sessions,[]);fail=true;assert.deepEqual((await cached.load()).sessions,[]);
  fail=false;empty=false;await cached.load();owners=[];await cached.load();owners=[{name:'builder'}];fail=true;assert.deepEqual((await cached.load()).sessions,[]);
 });
 await test('late older load cannot overwrite newer verified cache',async()=>{
  let release,step=0;
  const cached=new ChatSource({...client,profilesList:async()=>[{name:'builder'}]},{...manager,sessions:async()=>{if(step++===0)return new Promise(resolve=>{release=resolve;});if(step===2)return [row('new')];throw Error('read failed');}});
  const old=cached.load();while(!release)await new Promise(resolve=>setTimeout(resolve,0));await cached.load();release([row('old')]);await old;assert.deepEqual((await cached.load()).sessions.map(r=>r.id),['new']);
 });
 await test('confirmed exact deletion cannot reappear from retained read cache',async()=>{
  let deleted=false;
  const cached=new ChatSource({...client,profilesList:async()=>[{name:'builder'}],sessionFindBotChat:async()=>null,sessionDelete:async id=>{deleted=true;return {deleted:id};}},{...manager,sessions:async()=>{if(deleted)throw Error('later read failed');return [row('gone')];},sessionIdentity:async(profile,id)=>{if(deleted)throw new ManagementError('unsupported','Absent','none',404);return {profile,id};}});
  await cached.load();await cached.delete(row('gone'),true);assert.deepEqual((await cached.load()).sessions,[]);
 });
 await test('later-page failure retains verified first-page rows with explicit incomplete coverage',async()=>{
  const adapter=new ManagementClient(client,async input=>{const url=new URL(input);if(url.pathname==='/api/profiles/active')return Response.json({current:'builder'});const offset=Number(url.searchParams.get('offset'));return offset?Response.json({detail:'PRIVATE'},{status:503}):Response.json({sessions:[row('page-one')],total:101,limit:100,offset:0});});
  const cached=new ChatSource({...client,profilesList:async()=>[{name:'builder'}]},adapter);const data=await cached.load();
  assert.deepEqual(data.sessions.map(r=>r.id),['page-one']);assert.deepEqual(data.failedProfiles,['builder']);assert.equal(data.readFailures[0].status,503);assert.equal(data.projects.length,0);
 });
 await test('read diagnostics preserve HTTP class but redact dynamic path, query and server body',async()=>{
  const adapter=new ManagementClient(client,async()=>Response.json({detail:'PRIVATE_BODY'},{status:503}));
  await assert.rejects(()=>adapter.sessionIdentity('builder','PRIVATE_ID'),e=>e.status===503&&e.operation==='GET /api/sessions/:id'&&!e.message.includes('PRIVATE')&&!e.message.includes('No state changed.'));
 });
 console.log(`chat source: ${checks} checks PASS`);
} finally {rmSync(out,{recursive:true,force:true});}
