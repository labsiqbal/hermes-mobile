#!/usr/bin/env node
// Actual built App, native Chrome layout/input. Fictional gateway boundaries only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProductionBrowser, serveDist, domHelpers, Journeys, ROOTS } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';
const app = path.resolve(process.argv[3] || '.');
const output = path.resolve(process.argv[2] || '/tmp/hm-appearance-browser');
await mkdir(output, { recursive:true });
const host = await serveDist(app);
const browser = new ProductionBrowser({ origin:host.origin, assetPaths:host.assetPaths, output, deadline:900000, timeout:5000, chrome:'/usr/bin/google-chrome' });
const report = { evidence:'BUILT-APP-FICTIONAL-APPEARANCE', checks:[], layout:[], screenshots:[], artifact:host.hashes };
const q = JSON.stringify;
const fixture = structuredClone(FIXTURE);
fixture.historyBySession = { 'qa-project-session': [
  {role:'user',content:'Fictional appearance reading test.'},
  {role:'assistant',content:Array.from({length:35},(_,n)=>`Appearance paragraph ${n}. ` + 'A stable semantic reading anchor across density changes. '.repeat(5)).join('\n\n')+'\n\nQA restored answer qa-project-session'},
] };
const check = async (name, fn) => { try { await fn(); report.checks.push({name,status:'passed'}); } catch(e) { report.checks.push({name,status:'failed',error:e.stack}); } };
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`const kept=Object.entries(localStorage).filter(([k])=>k==='hermes-mobile.ui-scale'||k==='unrelated-app');(${installProductionFixtures.toString()})(${q(fixture)});kept.forEach(([k,v])=>localStorage.setItem(k,v));(${domHelpers.toString()})();`});
  await browser.open(host.origin+'/');
  const j = new Journeys(browser,report,output);
  const resize = async (w,h) => { await browser.viewport(w,h); await browser.waitFor(`innerWidth===${w}&&document.querySelector('#root').getBoundingClientRect().height===${h}`); await browser.settle(); };
  const select = async scale => {
    await browser.evaluate(`(()=>{const e=document.querySelector('#ui-scale');e.value=${q(String(scale))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.settle();
    assert.equal(await browser.evaluate('document.documentElement.dataset.uiScale'),String(scale));
  };
  const settings = async () => { await j.root('Manage'); if(await browser.evaluate('!!__qaDOM.find("Back to Manage")')) await j.tap('Back to Manage'); await j.tap('Devices & gateways','body',false); await j.tap('Appearance','body',false); await j.text('UI scale'); };
  const audit = async (name, shot=false) => {
    await check(name,async()=>{
      await j.auditLayout(name);
      const m=await browser.evaluate(`(()=>{const v=__qaDOM.visible,header=[...document.querySelectorAll('header')].filter(v)[0],tabs=[...document.querySelectorAll('.shell-tabbar')].filter(v),r=header?.getBoundingClientRect();return {header:r&&[r.top,r.bottom],tabs:tabs.map(e=>{const r=e.getBoundingClientRect();return [r.top,r.bottom]}),zoom:getComputedStyle(document.documentElement).zoom,transform:getComputedStyle(document.documentElement).transform};})()`);
      assert.ok(m.header&&m.header[0]>=0&&m.header[1]<=await browser.evaluate('innerHeight'));
      assert.equal(m.zoom,'1'); assert.equal(m.transform,'none');
      const density=await browser.evaluate(`({scale:document.documentElement.dataset.uiScale,font:getComputedStyle(document.body).fontSize,editors:[...document.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(__qaDOM.visible).map(e=>({label:e.getAttribute('aria-label')||e.id,font:parseFloat(getComputedStyle(e).fontSize)}))})`);
      assert.equal(density.font,{'75':'12px','100':'16px','125':'20px'}[density.scale]);
      assert.ok(density.editors.every(e=>e.font>=16),q(density));
      for(const [,bottom] of m.tabs) assert.equal(bottom,await browser.evaluate('innerHeight'));
    });
    if(shot) await j.shot(name);
  };
  await j.tap(fixture.gateway.label,'body',false); await j.text('QA Project conversation');
  await check('Standard default and exact choices',async()=>{
    await settings(); assert.equal(await browser.evaluate('document.querySelector("#ui-scale").value'),'100');
    assert.deepEqual(await browser.evaluate('[...document.querySelector("#ui-scale").options].map(o=>o.text)'),['75% Compact','100% Standard','125% Large']);
  });
  await j.tap('Back');
  // Regression: change scale through Settings while a preserved chat is hidden.
  await check('semantic transcript anchor, draft and identity across Settings scale',async()=>{
    await j.root('Home'); await j.tap('QA Project conversation','body',false); await j.text('QA restored answer qa-project-session');
    await j.type('textarea','Appearance unsent draft');
    const before=await browser.evaluate(`(()=>{const b=document.querySelector('.chat-view .body'),p=[...b.querySelectorAll('p')].find(e=>e.textContent.startsWith('Appearance paragraph 12.'));b.scrollTop+=p.getBoundingClientRect().top-b.getBoundingClientRect().top-20;b.dispatchEvent(new Event('scroll'));window.__appearanceAnchor=p;return {offset:p.getBoundingClientRect().top-b.getBoundingClientRect().top,identity:JSON.stringify(history.state.route.conversation)};})()`);
    await browser.settle(); await j.tap('Back'); await settings(); await select(75); await j.tap('Back'); await j.root('Home'); await j.tap('QA Project conversation','body',false);
    const after=await browser.evaluate(`({offset:[...document.querySelectorAll('.chat-view .body p')].find(e=>e.textContent.startsWith('Appearance paragraph 12.')).getBoundingClientRect().top-document.querySelector('.chat-view .body').getBoundingClientRect().top,identity:JSON.stringify(history.state.route.conversation),draft:document.querySelector('textarea').value})`);
    assert.equal(after.identity,before.identity); assert.equal(after.draft,'Appearance unsent draft'); assert.ok(Math.abs(after.offset-before.offset)<3,q({before,after}));
    await j.tap('Scroll to bottom');
    await browser.waitFor("!document.querySelector('.jump-btn') && (()=>{const b=document.querySelector('.chat-view .body');return b.scrollHeight-b.clientHeight-b.scrollTop<3})()");
    await j.tap('Back'); await settings(); await select(125); await j.tap('Back'); await j.root('Home'); await j.tap('QA Project conversation','body',false);
    assert.ok(await browser.evaluate('(()=>{const b=document.querySelector(".chat-view .body");return b.scrollHeight-b.clientHeight-b.scrollTop<3})()'));
  });
  // Recover even if the anchor RED fails, then collect the complete matrix.
  for(const scale of [75,100,125]) {
    await settings(); await select(scale);
    await check(`persist-${scale}`,async()=>assert.equal(await browser.evaluate('localStorage.getItem("hermes-mobile.ui-scale")'),String(scale)));
    await j.tap('Back');
    for(const [w,h] of [[320,844],[390,844],[430,844],[390,480]]) {
      const tag=`${scale}-${w}x${h}`, detailShots=w===390&&h===844;
      await resize(w,h);
      for(const root of ROOTS) { await j.root(root); await audit(`${tag}-${root}`,true); }
      await j.tap('Devices & gateways','body',false); await audit(`${tag}-Settings`,true);
      await j.tap('Appearance','body',false); await audit(`${tag}-Appearance`,true); await j.tap('Back');
      await j.tap('Erase Hermes Mobile data'); await audit(`${tag}-erase-confirmation`,detailShots); await j.tap('Cancel'); await j.tap('Back');
      for(const [section,expected,detail] of [
        ['Profiles','Profiles on this gateway','QA Fixture Bot'],['Capabilities','QA Fixture Skill'],['Memory','QA Fixture Memory','QA Fixture Memory'],['Schedules & cron','QA Fixture Schedule','QA Fixture Schedule'],['Messaging','QA Fixture Messaging','QA Fixture Messaging'],['Webhooks','No webhook request was sent'],['Kanban','QA Fixture Board','QA Fixture Board'],['Appearance & preferences','Model and reasoning controls'],['Native capabilities','SSH & cloud lifecycle'],
      ]) {
        await j.tap(section,'.manage',false);
        if(['Capabilities','Memory','Schedules & cron','Messaging'].includes(section)) { await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label="Management profile"]');e.value='default';e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await browser.settle(); }
        await j.text(expected); if(detail) await j.tap(detail,'.manage',false);
        await audit(`${tag}-Manage-${section.replaceAll(/[^a-z]+/gi,'-')}`,detailShots);
        if(section==='Profiles') { await j.type('textarea[aria-label="Profile description"]','Fictional unsaved review'); await j.tap('Review description change'); await j.text('Confirm description change'); await audit(`${tag}-profile-review`,detailShots); await j.tap('Cancel','dialog'); }
        await j.tap('Back to Manage');
      }
      await j.root('Cronjobs'); await j.tap('QA Fixture Schedule','.manage-detail',false); await audit(`${tag}-Schedule`,detailShots); await j.tap('Runs'); await j.tap('QA tracked run','body',false); await j.text('QA fixture run output'); await audit(`${tag}-Run`,detailShots);
      await j.root('Chats'); await j.tap('Groups','body',false); await audit(`${tag}-Groups`,detailShots); await j.tap('QA Fixture group','body',false); await j.text('QA group history'); await audit(`${tag}-Group-chat`,detailShots); await j.tap('Back'); await j.tap('Back');
      await j.root('Chats'); await j.selectChatFilter('Project filter','recent'); await j.selectChatFilter('Profile filter','qa-bot'); await j.tap('Bot Chat','.chat-session-row',false); await j.text('QA restored answer qa-bot-session'); await audit(`${tag}-Bot-history`,detailShots); await j.tap('Back');
      const botTraceStart=await browser.evaluate('__productionFixture.trace.length'); await browser.evaluate(`__productionFixture.permits['session.create']=1`); await j.root('Bots'); await j.tap('QA Fixture Bot','body',false); await browser.waitFor("history.state.route.conversation?.session?.id === 'qa-bot-private-session'"); await audit(`${tag}-Bot-private`,detailShots);
      await check(`${tag}-Bot-private-session`,async()=>{const opened=await browser.evaluate(`__productionFixture.trace.slice(${botTraceStart})`);assert.equal(await browser.evaluate('document.querySelector("textarea").value'),'');assert.deepEqual(opened.filter(t=>t.method==='session.create').map(t=>t.params),[{profile:'qa-bot'}]);assert.ok(opened.some(t=>t.method==='session.resume'&&t.params.session_id==='qa-bot-private-session'&&t.params.profile==='qa-bot'));assert.ok(!opened.some(t=>t.method==='session.resume'&&t.params.session_id==='qa-bot-session'));}); await j.tap('Back');
      await j.root('Home'); await j.tap('QA Project conversation','body',false); await j.text('QA restored answer qa-project-session');
      for(const [mode,draft] of [['single','Draft'],['multiline','Line one\nLine two\nLine three\nLine four\nLine five']]) {
        await j.type('textarea',draft);
        await browser.evaluate("(()=>{const b=document.querySelector('.chat-view .body');b.scrollTop=250;b.dispatchEvent(new Event('scroll'));})()"); await j.text('Appearance paragraph'); await browser.waitFor('!!document.querySelector(".jump-btn")');
        await check(`${tag}-composer-${mode}`,async()=>{
          const m=await browser.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},el=s=>document.querySelector(s),sels=['.composer-input','.composer-plus','.model-pill','.composer-action','.jump-btn','.conversation-tools button'],rs=sels.map(s=>rect(el(s)));return {card:rect(el('.composer-pill')),rs,hit:sels.slice(1).map(s=>{const e=el(s),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit)}),font:getComputedStyle(el('.bubble-bot')).fontSize,identity:history.state.route.conversation};})()`);
          report.layout.push({name:`${tag}-composer-${mode}`,...m});
          const [input,attach,model,send,jump,context]=m.rs,c=m.card;
          for(const r of [input,attach,model,send]) assert.ok(r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom,q(m));
          assert.ok(input.bottom<=attach.top&&attach.right<=model.left&&model.right<=send.left);
          assert.ok(jump.bottom<c.top&&context.bottom<c.top);
          for(const r of m.rs.slice(1)) assert.ok(r.width>=44&&r.height>=44&&r.top>=0&&r.bottom<=h&&r.left>=0&&r.right<=w,q(m));
          assert.ok(m.hit.every(Boolean),q(m)); assert.equal(m.font,{75:'12px',100:'15px',125:'18.75px'}[scale]);
          if(mode==='multiline') assert.ok(input.height>90);
        });
        await audit(`${tag}-chat-${mode}`,true);
      }
      await j.type('textarea',''); await j.tap('Attach'); await audit(`${tag}-Attach`,detailShots); await j.tap('Attach');
      await j.clickCSS('.model-pill'); await j.text('QA Fixture Provider'); await audit(`${tag}-Model-sheet`,true);
      await check(`${tag}-reasoning-scroll-targets`,async()=>{
        const metrics=await browser.evaluate(`(()=>{const row=document.querySelector('.reasoning-row'),chips=[...row.querySelectorAll('button')];row.scrollIntoView({block:'center'});return {wrap:getComputedStyle(row).flexWrap,heights:chips.map(e=>e.getBoundingClientRect().height),overflow:getComputedStyle(row).overflowX};})()`);
        assert.equal(metrics.wrap,'nowrap'); assert.equal(metrics.overflow,'auto'); assert.ok(metrics.heights.every(h=>h>=44));
      });
      await j.type('.model-sheet-search input','fixture-alternative'); await j.text('fixture-alternative'); await audit(`${tag}-Model-search`,detailShots); await j.tap('Close');
      await browser.evaluate(`__productionFixture.emit('message.start','qa-project-session',{});`); await browser.waitFor('!!document.querySelector(".composer-stop")');
      await j.type('textarea','Steer draft'); await audit(`${tag}-Stop-and-steer`,detailShots);
      await browser.evaluate(`__productionFixture.emit('message.complete','qa-project-session',{text:'Fictional settled appearance reply',status:'completed'});__productionFixture.approval=true;__productionFixture.emit('approval.request','qa-project-session',{request_id:'qa-approval',command:'fictional operation never executed',description:'Appearance approval fixture',choices:['once','deny']});`);
      await j.text('Approval needed'); await audit(`${tag}-Approval`,detailShots);
      await browser.evaluate(`__productionFixture.permits['approval.respond']=1`); await j.tap('Deny'); await browser.waitFor('!document.body.innerText.includes("Approval needed")');
      await j.tap('Workspace','body',false); await j.text('CONVERSATION WORKSPACE');
      for(const tool of ['Files','Git','Terminal','Preview']) {
        await j.tap(tool,'nav[aria-label="Workspace tool"]');
        if(tool==='Files'||tool==='Git') await j.tap('README.md','body',false);
        await audit(`${tag}-Workspace-${tool}`,detailShots);
        if(tool==='Preview') { await j.type('#workspace-preview-url','https://preview.production-qa.invalid/'); await j.tap('Review preview link'); await audit(`${tag}-Preview-review`,detailShots); await j.tap('Cancel preview'); }
      }
      await j.tap('Back to conversation'); await j.tap('Back');
      await j.root('Home'); await j.tap('Open command palette'); await audit(`${tag}-Palette`,detailShots); await j.tap('Close command palette');
    }
  }
  await resize(390,844);
  await check('reload persistence without first-React-paint flash',async()=>{
    await settings(); await select(75);
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`new MutationObserver((_,o)=>{if(document.querySelector('#root')?.children.length){window.__firstScale=document.documentElement.dataset.uiScale;o.disconnect();}}).observe(document,{childList:true,subtree:true});`});
    await browser.open(host.origin+'/'); assert.equal(await browser.evaluate('window.__firstScale'),'75');
  });
  await check('invalid saved density safely boots Standard',async()=>{
    await browser.evaluate('localStorage.setItem("hermes-mobile.ui-scale","999px")'); await browser.open(host.origin+'/'); assert.equal(await browser.evaluate('document.documentElement.dataset.uiScale'),'100');
  });
  await check('Settings erase removes appearance and keeps unrelated origin data',async()=>{
    await j.tap(fixture.gateway.label,'body',false); await settings(); await select(125);
    await browser.evaluate('localStorage.setItem("unrelated-app","keep")'); await j.tap('Back'); await j.tap('Erase Hermes Mobile data'); await j.tap('Erase & reload'); await browser.waitFor('document.documentElement.dataset.uiScale === "100"');
    assert.equal(await browser.evaluate('localStorage.getItem("hermes-mobile.ui-scale")'),null); assert.equal(await browser.evaluate('localStorage.getItem("unrelated-app")'),'keep');
  });
  await check('storage unavailable still applies local appearance safely',async()=>{
    // Block just the appearance namespace; the existing connection fixture needs its own storage.
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k==='hermes-mobile.ui-scale')throw new DOMException('blocked','SecurityError');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(k==='hermes-mobile.ui-scale')throw new DOMException('blocked','SecurityError');return set.call(this,k,v)};`});
    await browser.open(host.origin+'/'); assert.equal(await browser.evaluate('document.documentElement.dataset.uiScale'),'100'); await j.tap(fixture.gateway.label,'body',false); await settings(); await select(75); await j.text('Browser storage is unavailable');
  });
  report.fixture=await browser.evaluate('({trace:__productionFixture.trace,violations:__productionFixture.violations})');
  await check('no unexpected outbound or runtime mutation',async()=>{
    assert.deepEqual(browser.diagnostics,[]); assert.deepEqual(host.rejected,[]); assert.deepEqual(report.fixture.violations,[]);
    assert.ok(!report.fixture.trace.some(t=>['config.set','prompt.submit','profiles.configure','session.create','session.delete'].includes(t.method)));
  });
  report.status=report.checks.every(c=>c.status==='passed')?'passed':'failed';
} catch(e) { report.status='failed'; report.error=e.stack; report.dom=await browser.evaluate('document.body.innerText').catch(()=>null); }
finally {
  report.diagnostics=browser.diagnostics; report.cleanup=await browser.close(); host.server.closeAllConnections(); await new Promise(r=>host.server.close(r)); report.serverClosed=!host.server.listening;
  if(!report.cleanup.exited||!report.cleanup.profileRemoved||!report.serverClosed) report.status='failed';
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='failed').map(c=>({name:c.name,error:c.error})),error:report.error,report:path.join(output,'report.json')},null,2));
assert.equal(report.status,'passed');
