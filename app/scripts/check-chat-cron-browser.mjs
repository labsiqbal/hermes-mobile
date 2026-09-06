#!/usr/bin/env node
// Built React + fictional transport, same isolated host/CDP guards as the production gate.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2] || '/tmp/hm-chat-cron-browser');
assert.ok(!output.startsWith(path.join(app,'dist')));
await mkdir(output,{recursive:true});
const fixture=structuredClone(FIXTURE);
fixture.preservePreferences=true;
const row=(id,title,profile='default')=>({...fixture.sessions[1],id,title,profile});
const older=row('qa-older','QA Older project chat');
const a=[fixture.sessions[0],row('qa-a2','QA Project second'),row('qa-a3','QA Project third'),row('qa-a4','QA Project fourth'),older];
const b=row('qa-b','QA Second conversation'), c=row('qa-c','QA Third conversation');
const overlap=row('qa-project-session','QA Other profile conversation','qa-bot');
const misleading=row('qa-misleading','Bot Chat');
fixture.sessions.push(...a.slice(1),b,c,overlap,misleading,fixture.bot);
const project=(id,label,profile,rows,extra={})=>({id,label,profile,...extra,sessionCount:rows.length,previewSessions:rows.slice(0,3),repos:[{id:`${id}-repo`,groups:[{id:'lane',sessions:rows}]}]});
fixture.projects=[project('__no_project__','Home','default',[fixture.sessions[1]],{isNoProject:true}),project('qa-project','QA Project','default',a),project('qa-second','QA Second','default',[b]),project('qa-third','QA Third','default',[c]),project('empty','Empty registry project','default',[]),project('qa-project','QA Other project','qa-bot',[overlap])];
fixture.overviewOmitIds=['qa-older'];
const host=await serveDist(app);
const browser=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:120000,timeout:5000,chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const report={evidence:'BUILT-REACT-FICTIONAL-CHAT-CRON',checks:[],layout:[],screenshots:[],artifact:host.hashes};
const q=JSON.stringify;
try {
 await browser.start();
 await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${q(fixture)});(${domHelpers.toString()})();`});
 await browser.open(host.origin+'/');
 const j=new Journeys(browser,report,output);
 const f=expression=>browser.evaluate(`(()=>{const f=__productionFixture;${expression}})()`);
 const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
 const select=async(label,value)=>{await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label='+${q(JSON.stringify(label))}+']');if(!e||![...e.options].some(o=>o.value===${q(value)}))throw Error('Missing filter option');e.value=${q(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await browser.settle();};
 const rows=()=>browser.evaluate("[...document.querySelectorAll('.chat-session-row')].map(e=>[e.dataset.profile,e.dataset.sessionId])");
 const projectOrder=()=>browser.evaluate("[...document.querySelectorAll('[data-project-id]')].map(e=>JSON.parse(e.dataset.projectId))");
 const waitLoaded=()=>browser.waitFor("document.querySelector('[aria-label=\"Refresh Chats\"]')?.disabled===false && !!document.querySelector('[data-project-id]')");
 await j.tap(fixture.gateway.label,'body',false);await j.text('QA Project conversation');await j.root('Chats');await waitLoaded();
 await check('flat no-search real projects; synthetic Home rows retained in Recent',async()=>{
  assert.equal(await browser.evaluate("!!document.querySelector('.chatlist input[type=search]')"),false);
  assert.deepEqual(await projectOrder(),[['default','qa-project'],['default','qa-second'],['default','qa-third'],['qa-bot','qa-project']]);
  assert.ok((await rows()).some(([p,id])=>p==='default'&&id==='qa-recent-session'));
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.project-group')].every(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(e).borderRadius==='0px')"),true);
 });
 await check('multiple pins independent unpin and same-gateway remount persistence',async()=>{
  await j.tap('Pin project QA Third');await j.tap('Pin project QA Second');
  assert.deepEqual((await projectOrder()).slice(0,2),[['default','qa-second'],['default','qa-third']]);
  await j.root('Home');await j.root('Chats');await waitLoaded();
  assert.equal(await browser.evaluate("document.querySelectorAll('.project-pin[aria-pressed=true]').length"),2);
  await browser.command('Page.reload');await browser.settle();await waitLoaded();
  assert.equal(await browser.evaluate("document.querySelectorAll('.project-pin[aria-pressed=true]').length"),2);
  await j.tap('Unpin project QA Second');
  assert.deepEqual((await projectOrder()).slice(0,3),[['default','qa-third'],['default','qa-project'],['default','qa-second']]);
 });
 await check('hydration exceeds preview and reconciles older Recent membership',async()=>{
  await j.tap('QA Project','.project-heading',false);
  await j.text('QA Project fourth');await j.text('QA Older project chat');
  assert.equal((await rows()).filter(([p,id])=>p==='default'&&id==='qa-older').length,1);
  assert.equal((await rows()).filter(([p,id])=>p==='default'&&id==='qa-project-session').length,1);
 });
 await check('Project + Profile combine, overlapping ids stay owned',async()=>{
  await select('Project filter',JSON.stringify(['default','qa-project']));await select('Profile filter','qa-bot');
  assert.equal((await rows()).length,0);
  await select('Project filter',JSON.stringify(['qa-bot','qa-project']));await j.tap('QA Other project','.project-heading',false);await j.text('QA Other profile conversation');
  assert.deepEqual(await rows(),[['qa-bot','qa-project-session']]);
  assert.equal(await browser.evaluate("document.querySelector('.chat-delete').disabled"),true);
  await j.tap('QA Other profile conversation','.chat-session-row',false);await j.text('QA restored answer qa-project-session');
  assert.equal(await browser.evaluate('history.state.route.profile'),'qa-bot');
  await j.type('textarea','OTHER PROFILE DRAFT');await j.tap('Back');await j.back(1);await j.text('QA restored answer qa-project-session');
  assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'OTHER PROFILE DRAFT');await j.tap('Back');await waitLoaded();
 });
 await check('Bot filter uses canonical identity, no title heuristic or duplicate',async()=>{
  await select('Chat type','bot');
  assert.deepEqual(await rows(),[['qa-bot','qa-bot-session']]);
  assert.equal(await browser.evaluate("document.querySelector('.chat-delete').disabled"),true);
  await select('Profile filter','default');assert.equal((await rows()).length,0);
  await select('Profile filter','qa-bot');await j.tap('Bot Chat','.chat-session-row',false);await j.text('QA restored answer qa-bot-session');
  assert.equal(await browser.evaluate('history.state.route.profile'),'qa-bot');await j.tap('Back');await waitLoaded();
 });
 await check('cancel deletion does not dispatch; confirmation frozen exact owner/id',async()=>{
  await j.tap('Delete session QA Recent conversation');await j.text('Delete this session?');await j.tap('Cancel','dialog');
  assert.equal((await f('return f.trace')).filter(t=>t.method==='session.delete').length,0);
  await j.tap('Delete session QA Project fourth');await j.text('Delete this session?');await j.shot('delete-confirmation');
  await f("f.permits['session.delete']=1;");await j.tap('Delete','dialog');await waitLoaded();
  await browser.waitFor("!document.querySelector('[data-session-id=qa-a4]')");
  const writes=(await f('return f.trace')).filter(t=>t.method==='session.delete');
  assert.deepEqual(writes.map(w=>w.params),[{session_id:'qa-a4',profile:'default'}]);
  const detail=(await f('return f.trace')).filter(t=>t.route==='GET /api/sessions/qa-a4');assert.equal(detail.length,2);
  await j.tap('Refresh Chats');await waitLoaded();assert.equal((await rows()).filter(([,id])=>id==='qa-a4').length,0);
 });
 await check('disconnect cancels pending confirmation; reconnect refreshes hydration',async()=>{
  await j.tap('Delete session QA Older project chat');await j.text('Delete this session?');await f('f.offline();');await browser.waitFor("!document.querySelector('dialog[open]')");
  await f('f.online();');await browser.waitFor("!document.querySelector('.connection-notice')");await waitLoaded();
  assert.equal(await browser.evaluate("!!document.querySelector('dialog[open]')"),false);
  assert.equal((await f('return f.trace')).filter(t=>t.method==='session.delete').length,1);
 });
 await check('unsupported projects retain owner-verified history in Recent',async()=>{
  await f("f.unsupported.push('projects.tree');");await j.tap('Refresh Chats');await browser.waitFor("document.querySelector('[aria-label=\"Refresh Chats\"]').disabled===false");
  assert.ok((await rows()).some(([p,id])=>p==='default'&&id==='qa-project-session'));await j.text('not supported');
  await f("f.unsupported=[];");await j.tap('Refresh Chats');await waitLoaded();
 });
 await check('model above-right placement and compact 44px target at mobile widths',async()=>{
  await j.tap('QA Project conversation','.chat-session-row',false);await j.text('QA restored answer qa-project-session');
  for(const width of [360,390,430]) {
   await browser.viewport(width,844);await j.auditLayout(`model-${width}`);
   const geometry=await browser.evaluate("(()=>{const p=document.querySelector('.model-pill'),c=document.querySelector('.composer-pill'),a=p.getBoundingClientRect(),b=c.getBoundingClientRect();return{above:a.bottom<=b.top,right:Math.abs(a.right-b.right),height:a.height,width:a.width,header:!!p.closest('header'),parent:p.parentElement.parentElement.className}})()");
   assert.equal(geometry.above,true);assert.ok(geometry.right<=1);assert.ok(geometry.height>=44&&geometry.width>=44);assert.equal(geometry.header,false);report.checks.push({name:`model geometry ${width}`,geometry,status:'passed'});
   await j.shot(`model-closed-${width}`);await j.clickCSS('.model-pill');await j.text('QA Fixture Provider');await j.shot(`model-open-${width}`);await j.tap('Close');
  }
  await j.tap('Back');
 });
 await check('Cronjobs schedules/details and Runs return path',async()=>{
  await j.root('Cronjobs');await j.text('QA Fixture Schedule');await j.tap('QA Fixture Schedule','.manage-detail',false);await j.text('every 7d');await j.text('2030-01-07T08:00:00Z');await j.text('No');
  for(const width of [360,390,430]) {
   await browser.viewport(width,844);await j.auditLayout(`cronjobs-${width}`);
   const geometry=await browser.evaluate("(()=>{const root=document.querySelector('.cronjobs'),s=root.querySelector('select'),heading=root.querySelector('h2'),r=root.getBoundingClientRect(),a=s.getBoundingClientRect(),h=heading.getBoundingClientRect(),style=getComputedStyle(s);return {left:a.left-r.left,right:r.right-a.right,headingLeft:h.left-r.left,height:a.height,background:style.backgroundColor,themeBackground:getComputedStyle(document.querySelector('.manage-button')).backgroundColor,radius:style.borderRadius,scrollable:getComputedStyle(root).overflowY}})()");
   assert.ok(geometry.left>=16&&geometry.right>=16&&geometry.headingLeft>=16,JSON.stringify(geometry));assert.ok(geometry.height>=44);assert.equal(geometry.background,geometry.themeBackground);assert.equal(geometry.radius,'8px');assert.equal(geometry.scrollable,'auto');report.checks.push({name:`Cronjobs geometry ${width}`,geometry,status:'passed'});
   await j.shot(`cronjobs-${width}`);
  }
  await j.tap('Runs');await j.text('QA tracked run');await j.tap('QA tracked run','body',false);await j.text('QA fixture run output');await j.tap('← Back to Cronjobs');await j.text('QA Fixture Schedule');
 });
 await check('Cronjobs empty/error/unsupported/wrong-owner reads fail honestly',async()=>{
  await f("f.empty.push('GET /api/cron/jobs');");await j.tap('Refresh Scheduled jobs');await j.text('No scheduled jobs returned');
  await f("f.empty=[];f.errors['GET /api/cron/jobs']='fixture failure';");await j.tap('Refresh Scheduled jobs');await j.text('refused this read');
  await f("delete f.errors['GET /api/cron/jobs'];f.unsupported.push('GET /api/cron/jobs');");await j.tap('Refresh Scheduled jobs');await j.text('unavailable on this gateway');
  await f("f.unsupported=[];");await select('Cronjobs profile','qa-bot');await j.text('ownership did not match');
  assert.equal(await browser.evaluate("document.body.innerText.includes('QA Fixture Schedule')"),false);
  await f("f.cronOwner='qa-bot';");await j.tap('Refresh Scheduled jobs');await j.text('QA Fixture Schedule');
 });
 await j.root('Chats');await waitLoaded();await browser.viewport(390,844);await j.auditLayout('chats-final');await j.shot('chats-final');
 report.fixture=await f('return {trace:f.trace,violations:f.violations}');
 assert.deepEqual(report.fixture.violations,[]);assert.deepEqual(browser.diagnostics,[]);assert.deepEqual(host.rejected,[]);
 const forbidden=['prompt.submit','session.create','session.steer','session.interrupt','config.set','profiles.configure','projects.set_active','session.workspace.move'];assert.ok(!report.fixture.trace.some(t=>forbidden.includes(t.method)));
 report.status='passed';
} catch(error) {report.status='failed';report.error=error.stack;report.dom=await browser.evaluate('document.body.innerText').catch(()=>null);}
finally {
 report.diagnostics=browser.diagnostics;report.cleanup=await browser.close();host.server.closeAllConnections();await new Promise(resolve=>host.server.close(resolve));report.serverClosed=!host.server.listening;
 if(!report.cleanup.exited||!report.cleanup.profileRemoved||!report.serverClosed) report.status='failed';
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:path.join(output,'report.json'),error:report.error},null,2));
assert.equal(report.status,'passed');
