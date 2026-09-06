#!/usr/bin/env node
// Built app; fictional wire fixtures only. Never connects to a gateway.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';
const output=path.resolve(process.argv[2] || '/tmp/groups-ui-artifacts/browser');
await mkdir(output,{recursive:true});
const host=await serveDist(path.resolve('.'));
const browser=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:240000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={evidence:'BUILT-APP-FICTIONAL-GROUPS-UI',checks:[],layout:[],screenshots:[],artifact:host.hashes};
const q=JSON.stringify;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,status:'passed'});}catch(e){report.checks.push({name,status:'failed',error:e.message});}};
// Six plain profiles plus default and one metadata-decorated bot. Expose only
// fictional profile rows so failure/stale-roster/readback cases are controllable.
const fixtures=installProductionFixtures.toString().replace('const history = sid =>',`profiles.push(...Array.from({length:6},(_,i)=>({name:'qa-plain-'+i,display_name:'QA Plain '+i,description:'Fictional profile without bot metadata',ui_meta:{},ui_meta_revisions:{}})));control.profiles=profiles;const history = sid =>`).replace('Object.assign(profile.ui_meta, params.ui_meta);',`if(control.rejectAcknowledgment)return {applied:{ui_meta:false}};if(!(control.dropRegistry&&params.ui_meta['hermes-bots-groups']))Object.assign(profile.ui_meta, params.ui_meta);`);
try {
 await browser.start();
 await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${fixtures})(${q(FIXTURE)});(${domHelpers.toString()})();`});
 await browser.open(host.origin+'/');const j=new Journeys(browser,report,output);
 const change=async(selector,value)=>{await browser.evaluate(`(()=>{const e=document.querySelector(${q(selector)});const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${q(String(value))});e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await browser.settle();};
 const key=async(key,code,virtual)=>{await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual});await browser.settle();};
 const resize=async(w,h=844)=>{await browser.viewport(w,h);await browser.waitFor(`innerWidth===${w}&&document.querySelector('#root').getBoundingClientRect().height===${h}`);await browser.settle();};
 const groups=async()=>{await j.root('Chats');await j.tap('Groups','body',false);await j.tap('+ New group');};
 const audit=async(tag,shot=false)=>{await check(tag,()=>j.auditLayout(tag));await check(tag+' shared header',async()=>{const m=await browser.evaluate(`(()=>{const hs=[...document.querySelectorAll('header')].filter(__qaDOM.visible);return hs.map(h=>({top:h.getBoundingClientRect().top,bottom:h.getBoundingClientRect().bottom}));})()`);assert.equal(m.length,1);assert.equal(m[0].top,0);});if(shot)await j.shot(tag);};
 await j.tap(FIXTURE.gateway.label,'body',false);await resize(390);await groups();
 await check('All eight profiles eligible, only one has bot metadata',async()=>{assert.equal(await browser.evaluate(`__productionFixture.profiles.filter(p=>p.ui_meta['hermes-bots']).length`),1);assert.equal(await browser.evaluate(`document.querySelectorAll('.body .rowcard').length`),8);});
 await check('Create action does not collapse beside Cancel',async()=>{const m=await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Create Group'));const r=b.getBoundingClientRect();return {width:r.width,height:r.height};})()`);assert.ok(m.width>=140&&m.height>=44,q(m));});
 await j.shot('groups-before-or-after');
 if(process.argv.includes('--red')) { report.status=report.checks.some(c=>c.status==='failed')?'failed':'passed'; }
 else {
  await check('Minimum two, maximum six and removable keyboard buttons',async()=>{assert.equal(await browser.evaluate(`__qaDOM.find('Create Group (0)').disabled`),true);await j.tap('@qa-plain-0','.rowcard',false).catch(async()=>j.tap('@qa-plain-0','body',false));assert.equal(await browser.evaluate(`__qaDOM.find('Create Group (1)').disabled`),true);for(let i=1;i<6;i++)await j.tap('@qa-plain-'+i,'body',false);assert.equal(await browser.evaluate(`__qaDOM.find('Create Group (6)').disabled`),false);assert.equal(await browser.evaluate(`document.querySelectorAll('.body .rowcard:disabled').length`),2);await j.tap('Remove qa-plain-5');assert.equal(await browser.evaluate(`__qaDOM.find('Create Group (5)').disabled`),false);});
  await j.tap('Cancel');await j.tap('+ New group');
  await j.tap('@qa-plain-0','body',false);await j.tap('@qa-plain-1','body',false);
  await check('Negative acknowledgement never becomes success',async()=>{await browser.evaluate(`__productionFixture.rejectAcknowledgment=true;__productionFixture.permits['profiles.configure']=1;`);await j.tap('Create Group (2)');await j.text('not acknowledged');assert.equal(await browser.evaluate('location.hash'),'#groups');await browser.evaluate(`__productionFixture.rejectAcknowledgment=false;`);});
  await check('Acknowledged but missing registry readback stays in form',async()=>{await browser.evaluate(`__productionFixture.dropRegistry=true;__productionFixture.permits['profiles.configure']=3;`);await j.tap('Create Group (2)');await j.text('could not be verified');assert.equal(await browser.evaluate('location.hash'),'#groups');await browser.evaluate(`__productionFixture.dropRegistry=false;`);});
  await check('Rejected metadata write stays in form with visible error; no fake creation',async()=>{await browser.evaluate(`__productionFixture.errors['profiles.configure']='QA refused membership';`);await j.tap('Create Group (2)');await j.text('QA refused membership');assert.equal(await browser.evaluate('location.hash'),'#groups');assert.equal(await browser.evaluate(`!!__qaDOM.find('Create Group (2)')`),true);await browser.evaluate(`delete __productionFixture.errors['profiles.configure'];`);});
  await check('Disappeared selected profile fails before any write',async()=>{await browser.evaluate(`__productionFixture.removed=__productionFixture.profiles.splice(__productionFixture.profiles.findIndex(p=>p.name==='qa-plain-1'),1)[0];__productionFixture.trace.length=0;`);await j.tap('Create Group (2)');await j.text('no longer available');assert.equal(await browser.evaluate(`__productionFixture.trace.filter(t=>t.method==='profiles.configure').length`),0);await browser.evaluate(`__productionFixture.profiles.push(__productionFixture.removed);`);});
  await check('Exact members and gateway identity; verified registry before navigation',async()=>{await browser.evaluate(`__productionFixture.permits['profiles.configure']=3;__productionFixture.trace.length=0;`);await j.tap('Create Group (2)');await browser.waitFor(`location.hash==='#chat'`);const writes=await browser.evaluate(`__productionFixture.trace.filter(t=>t.method==='profiles.configure').map(t=>t.params)`);assert.equal(writes.length,3);assert.deepEqual(writes.slice(0,2).map(w=>w.name),['qa-plain-0','qa-plain-1']);const registry=writes[2].ui_meta['hermes-bots-groups'];const room=Object.values(registry.rooms).find(r=>r.roomId!=='qa-room');assert.deepEqual(room.members.map(m=>[m.name,m.connectionId,m.connectionLabel]),[['qa-plain-0',FIXTURE.gateway.id,FIXTURE.gateway.label],['qa-plain-1',FIXTURE.gateway.id,FIXTURE.gateway.label]]);assert.equal(writes[2].name,'default');assert.deepEqual(writes[2].ui_meta_expected_revisions,{'hermes-bots-groups':1});assert.ok((await browser.evaluate(`__productionFixture.trace.map(t=>t.method)`)).lastIndexOf('profiles.list')>2);});
  for(const scale of [75,100,125]) {
   await j.root('Manage');if(await browser.evaluate(`!!__qaDOM.find('Back to Manage')`))await j.tap('Back to Manage');await j.tap('Devices & gateways','body',false);await j.tap('Appearance','body',false);await change('#ui-scale',scale);
   for(const [w,h] of [[320,844],[390,844],[320,480]]) {
    await resize(w,h);const tag=`${scale}-${w}-${h}`;
    for(const root of ['Home','Chats','Bots','Cronjobs','Manage']) {await j.root(root);await audit(root+'-'+tag,w===390&&h===844&&scale===100);}
    await j.root('Manage');
    for(const section of ['Profiles','Memory','Capabilities','Schedules & cron','Messaging','Kanban','Webhooks','Appearance & preferences','Native capabilities']) {
     await j.tap(section,'.manage',false);const scoped=['Memory','Capabilities','Schedules & cron','Messaging'].includes(section);
     await check(section+' profile relevance '+tag,async()=>assert.equal(await browser.evaluate(`!!document.querySelector('[aria-label="Management profile"]')`),scoped));
     if(scoped)await change('[aria-label="Management profile"]','default');
     if(section==='Profiles')await j.tap('default','.manage',false);
     if(section==='Kanban')await j.tap('QA Fixture Board','.manage',false);
     await audit(section+'-'+tag,w===390&&h===844&&scale===100);await j.tap('Back to Manage');
    }
    await j.tap('Devices & gateways','body',false);await audit('Settings-'+tag,w===390&&scale===100);await j.tap('Appearance','body',false);await audit('Appearance-'+tag);
    await groups();await audit('Groups-create-'+tag,w===390&&h===844||w===320&&h===480&&scale===125);
    await check('All roster rows retain height '+tag,async()=>assert.ok(await browser.evaluate(`[...document.querySelectorAll('.body .rowcard')].every(e=>e.getBoundingClientRect().height>=44)`)));
    await browser.evaluate(`__qaDOM.find('Create Group (0)').scrollIntoView({block:'center'})`);await browser.settle();await audit('Groups-actions-'+tag,w===390&&h===844||w===320&&h===480&&scale===125);
    await check('Create/Cancel targets and text width '+tag,async()=>{const m=await browser.evaluate(`[...document.querySelectorAll('.group-create-actions button')].map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,right:r.right}})`);assert.equal(m.length,2);assert.ok(m[0].width>=140&&m.every(r=>r.height>=44&&r.left>=0&&r.right<=w));});
    await j.tap('Cancel');await audit('Groups-list-'+tag);
    await j.root('Chats');await browser.waitFor(`!document.querySelector('[aria-label="Refresh Chats"]').disabled`);await j.tap('Filter chats');await audit('Chats-filter-sheet-'+tag,true);
    await check('Sheet select gutter '+tag,async()=>{const m=await browser.evaluate(`[...document.querySelectorAll('.chat-filters select')].map(e=>{const s=getComputedStyle(e);return{inset:s.backgroundPosition,padding:parseFloat(s.paddingRight),width:e.getBoundingClientRect().width,font:parseFloat(s.fontSize)}})`);assert.equal(m.length,2);for(const s of m){assert.match(s.inset,/100% - (12|15)px/);assert.ok(s.padding>=32&&s.width>=240&&s.font>=16);}});
    await j.tap('Done');
   }
  }
  await resize(390);await j.root('Chats');await j.tap('Filter chats');await change('[aria-label="Project filter"]','recent');await change('[aria-label="Profile filter"]','qa-bot');await j.tap('Done');
  await check('Active summary count and exact two-filter semantics',async()=>{assert.ok(await browser.evaluate(`__qaDOM.find('Filter chats').innerText.includes('2')`));assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-session-id]')].map(e=>e.dataset.sessionId)`),['qa-bot-session']);});
  await j.tap('Clear filters');await j.tap('Filter chats');await key('Escape','Escape',27);await check('Escape closes and restores trigger focus',async()=>{assert.equal(await browser.evaluate(`!!document.querySelector('.chat-filter-sheet')`),false);assert.equal(await browser.evaluate(`document.activeElement.getAttribute('aria-label')`),'Filter chats');});
  await j.tap('Filter chats');await j.back();await check('Browser Back closes filter sheet without leaving Chats',async()=>{assert.equal(await browser.evaluate('location.hash'),'#chats');assert.equal(await browser.evaluate(`!!document.querySelector('.chat-filter-sheet')`),false);});
  await check('No real outbound, no prompts or session mutations',async()=>{assert.deepEqual(browser.diagnostics,[]);assert.deepEqual(host.rejected,[]);assert.deepEqual(await browser.evaluate('__productionFixture.violations'),[]);assert.equal(await browser.evaluate(`__productionFixture.trace.some(t=>['prompt.submit','session.create','session.delete','config.set'].includes(t.method))`),false);});
  report.status=report.checks.some(c=>c.status==='failed')?'failed':'passed';
 }
} catch(e){report.status='failed';report.error=e.stack;report.dom=await browser.evaluate('document.body.innerText').catch(()=>null);}
finally {report.diagnostics=browser.diagnostics;report.cleanup=await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));if(!report.cleanup.exited||!report.cleanup.profileRemoved)report.status='failed';await writeFile(path.join(output,'report.json'),q(report)+'\n');}
console.log(q({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='failed'),error:report.error,report:path.join(output,'report.json')}));assert.equal(report.status,'passed');
