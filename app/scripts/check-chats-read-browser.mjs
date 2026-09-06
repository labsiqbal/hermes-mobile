#!/usr/bin/env node
// Actual built App. Native fetch is never replaced; HTTP intercepted BELOW the Web API.
// Routes/shapes: pinned sessions.py:165-222, profiles/active.current. No live gateway.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const app=path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const output=path.resolve(process.argv[2] || '/tmp/hm-chats-read-browser');
assert.ok(!output.startsWith(path.join(app,'dist')));await mkdir(output,{recursive:true});
const host=await serveDist(app), fixture=structuredClone(FIXTURE);
fixture.nativeFetch=true;
// Native HTTP is same-origin; WS remains a strictly in-memory fixture.
fixture.gateway.url=host.origin;
fixture.sessions.push({...fixture.sessions[1],id:'qa-owned-other',profile:'qa-bot',title:'QA Other profile history'},fixture.bot);
class ReadBrowser extends ProductionBrowser {
  readMode='ok'; http=[]; expectedNetworkFailures=[];
  allowed(url) {try {if(new URL(url).origin===this.origin && new URL(url).pathname.startsWith('/api/')) return true;}catch{}return super.allowed(url);}
  onEvent(event) {
    if(event.sessionId===this.sessionId && event.method==='Fetch.requestPaused') {
      const {requestId,request}=event.params, url=new URL(request.url);
      if(url.origin===this.origin && url.pathname.startsWith('/api/')) {
        let body, status=200;
        const route=`${request.method} ${url.pathname}`,profile=url.searchParams.get('profile');
        this.http.push({route,query:url.search});
        if(route==='POST /api/auth/ws-ticket') body={ticket:'FICTIONAL-ONE-USE-TICKET'};
        else if(route==='GET /api/status') body={status:'ok',version:'fixture-only'};
        else if(route==='GET /api/profiles/active') body={current:'default',active:'qa-bot'};
        else if(route==='GET /api/sessions') {
          const offset=Number(url.searchParams.get('offset'));
          const expected=new URLSearchParams({profile,limit:'100',offset:String(offset),order:'recent',archived:'exclude',full:'false'});
          if(!['default','qa-bot'].includes(profile) || url.search!==`?${expected}`) {this.diagnostics.push({kind:'bad-session-query',query:url.search});status=400;body={};}
          else if(this.readMode==='failed' || this.readMode==='partial' && profile==='qa-bot') {status=503;body={detail:'PRIVATE_SERVER_BODY_NOT_FOR_UI'};}
          else if(this.readMode==='auth') {status=401;body={detail:'PRIVATE_AUTH_NOT_FOR_UI'};}
          else if(this.readMode==='html') {body='<html>PRIVATE_LOGIN_NOT_FOR_UI</html>';}
          else if(this.readMode==='network') {void this.command('Fetch.failRequest',{requestId,errorReason:'ConnectionFailed'});return;}
          else {
            const rows=fixture.sessions.filter(row=>row.profile===profile);
            body={sessions:rows.slice(offset,offset+100),total:rows.length,limit:100,offset};
          }
        } else {this.diagnostics.push({kind:'unexpected-native-route',route});status=404;body={};}
        void this.command('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:typeof body==='string'?'text/html':'application/json'}],body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)).toString('base64')}).catch(e=>this.diagnostics.push({kind:'fixture-http',message:e.message}));
        return;
      }
    }
    if(event.method==='Network.loadingFailed' && this.readMode==='network' && event.params.type==='Fetch' && event.params.errorText==='net::ERR_CONNECTION_FAILED') {this.expectedNetworkFailures.push(event.params.errorText);return;}
    // Browser console logs failed-resource statuses for intentional error cases.
    if(event.method==='Log.entryAdded' && event.params.entry.source==='network' && this.readMode!=='ok') return;
    super.onEvent(event);
  }
}
const browser=new ReadBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:150000,timeout:4000,chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const report={evidence:'BUILT-APP-NATIVE-FETCH-CDP-FIXTURES-NOT-LIVE',checks:[],layout:[],screenshots:[],artifact:host.hashes};
const q=JSON.stringify;
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${q(fixture)});(${domHelpers.toString()})();`});
  await browser.open(host.origin+'/');const j=new Journeys(browser,report,output);
  const check=async(name,fn)=>{try {await fn();report.checks.push({name,status:'passed'});}catch(e){report.checks.push({name,status:'failed',error:e.stack});}};
  const loaded=()=>browser.waitFor(`document.querySelector('[aria-label="Refresh Chats"]')?.disabled===false`);
  const select=async(label,value)=>{await browser.evaluate(`(()=>{const e=document.querySelector('select[aria-label='+${q(JSON.stringify(label))}+']');if(!e || ![...e.options].some(o=>o.value===${q(value)}))throw Error('Missing filter option');e.value=${q(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await browser.settle();};
  const rows=()=>browser.evaluate(`[...document.querySelectorAll('.chat-session-row')].map(e=>[e.dataset.profile,e.dataset.sessionId])`);
  await j.tap(fixture.gateway.label,'body',false);await j.root('Chats');await loaded();
  await check('native default ManagementClient dispatches real GETs and reaches project tree',async()=>{
    assert.equal(await browser.evaluate(`String(window.fetch).includes('[native code]')`),true);
    assert.ok(browser.http.some(r=>r.route==='GET /api/sessions'&&r.query.includes('profile=default')));
    assert.ok(browser.http.some(r=>r.route==='GET /api/sessions'&&r.query.includes('profile=qa-bot')));
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-project-id]').length`),1);
    assert.deepEqual(await browser.evaluate(`__productionFixture.trace.filter(r=>r.method==='projects.tree').map(r=>r.params.profile).sort()`),['default','qa-bot']);
    assert.ok((await rows()).some(([p,id])=>p==='qa-bot'&&id==='qa-owned-other'));
  });
  for(const width of [320,360,390,430]) {
    await browser.viewport(width,844);
    await check(`two compact 44px filters; truthful global failure at ${width}`,async()=>{
      const geometry=await browser.evaluate(`(()=>{const t=document.querySelector('.chat-filters'),r=t.getBoundingClientRect();return {width:innerWidth,height:r.height,selects:[...t.querySelectorAll('select')].map(e=>e.getAttribute('aria-label')),targets:[...t.querySelectorAll('select,button')].map(e=>{const a=e.getBoundingClientRect();return {left:a.left,right:a.right,width:a.width,height:a.height,bottom:a.bottom}})}})()`);
      assert.equal(geometry.width,width);assert.deepEqual(geometry.selects,['Project filter','Profile filter']);
      // HM-UX-09: narrow controls reflow rather than sacrifice readable labels
      // to the inset arrow. Preserve the original one-row bound elsewhere.
      const [project,profile,refresh]=geometry.targets;
      if(width<=360) {
        assert.ok(geometry.height<=140,JSON.stringify(geometry));
        assert.ok(project.bottom<=profile.bottom-profile.height,JSON.stringify(geometry));
        assert.equal(project.left,profile.left);
        assert.equal(project.right,refresh.right);
        assert.equal(profile.bottom,refresh.bottom);
      } else {
        assert.ok(geometry.height<=68,JSON.stringify(geometry));
        assert.equal(project.bottom,profile.bottom);
        assert.equal(profile.bottom,refresh.bottom);
      }
      assert.ok(geometry.targets.every(r=>r.height>=44 && r.width>=44 && r.left>=0 && r.right<=width));
      browser.readMode='failed';await j.tap('Refresh Chats');await loaded();
      assert.equal(await browser.evaluate(`document.querySelectorAll('.chat-read-status[role="status"]').length`),1);
      assert.equal(await browser.evaluate(`document.querySelectorAll('.chatlist [role="alert"]').length`),0);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('No state changed.') || document.body.innerText.includes('PRIVATE_SERVER')`),false);
      assert.ok((await rows()).some(([,id])=>id==='qa-recent-session'),'Last verified rows retained after refresh failure');
      assert.equal(await browser.evaluate(`document.querySelector('.chat-read-status details').open`),false);
      const statusBox=await browser.evaluate(`(()=>{const s=document.querySelector('.chat-read-summary'),a=s.querySelector('span').getBoundingClientRect(),b=s.querySelector('button').getBoundingClientRect(),r=s.getBoundingClientRect();return {height:r.height,textRight:a.right,buttonLeft:b.left,buttonRight:b.right,buttonHeight:b.height,textWidth:a.width}})()`);
      assert.ok(statusBox.height<=88 && statusBox.textWidth>=180 && statusBox.textRight<=statusBox.buttonLeft && statusBox.buttonRight<=width && statusBox.buttonHeight>=44,JSON.stringify(statusBox));
      await j.shot(`read-failure-${width}`);await j.tap('Read details');await j.text('HTTP 503');await j.text('GET /api/sessions');
      await j.shot(`read-details-${width}`);browser.readMode='ok';await j.tap('Retry');await loaded();
      assert.equal(await browser.evaluate(`!!document.querySelector('.chat-read-status')`),false);await j.shot(`chats-${width}`);
    });
    // Reset after red baseline assertions so every width has an independent result.
    browser.readMode='ok';await j.tap('Refresh Chats');await loaded();
    await check(`Project + Profile filter interactions and canonical protection ${width}`,async()=>{
      await select('Profile filter','qa-bot');assert.ok((await rows()).every(([p])=>p==='qa-bot'));
      assert.deepEqual((await rows()).map(([,id])=>id).sort(),['qa-bot-session','qa-owned-other']);
      assert.equal(await browser.evaluate(`document.querySelector('[data-session-id="qa-bot-session"] .chat-delete').disabled`),true);
      await select('Project filter',JSON.stringify(['default','qa-project']));assert.equal((await rows()).length,0);
      await select('Profile filter','default');if(await browser.evaluate(`document.querySelector('.project-heading .project-group-head')?.getAttribute('aria-expanded')==='false'`)) await j.tap('QA Project','.project-heading',false);await j.text('QA Project conversation');
      assert.deepEqual(await rows(),[['default','qa-project-session']]);
      await select('Project filter','recent');assert.deepEqual(await rows(),[['default','qa-recent-session']]);
      await select('Project filter','');await select('Profile filter','');
    });
  }
  await check('partial failure retains failed-owner history while successful owner refreshes',async()=>{
    browser.readMode='partial';await j.tap('Refresh Chats');await loaded();
    assert.ok((await rows()).some(([p,id])=>p==='qa-bot'&&id==='qa-owned-other'));
    assert.equal(await browser.evaluate(`document.querySelectorAll('.chat-read-status').length`),1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-session-id="qa-owned-other"] .chat-delete').disabled`),true);
  });
  await check('cold global failure is not a successful empty list; retry restores history',async()=>{
    browser.readMode='failed';await j.root('Home');await j.root('Chats');await loaded();
    await j.text('History could not be loaded');assert.equal(await browser.evaluate(`document.body.innerText.includes('No chats match')`),false);
    browser.readMode='ok';await j.tap('Retry');await loaded();assert.ok((await rows()).some(([,id])=>id==='qa-recent-session'));
  });
  for(const [mode,detail] of [['auth','HTTP 401'],['html','invalid'],['network','network']]) await check(`sanitized ${mode} read diagnostics`,async()=>{
    browser.readMode=mode;await j.tap('Refresh Chats');await loaded();await j.tap('Read details');await j.text(detail);
    assert.equal(await browser.evaluate(`document.body.innerText.includes('PRIVATE_') || document.body.innerText.includes('No state changed.')`),false);
    browser.readMode='ok';await j.tap('Retry');await loaded();
  });
  await check('roster failure preserves hydrated history with one sanitized status',async()=>{
    await select('Project filter','');await select('Profile filter','');
    if(await browser.evaluate(`document.querySelector('.project-heading .project-group-head')?.getAttribute('aria-expanded')==='false'`)) await j.tap('QA Project','.project-heading',false);
    await j.text('QA Project conversation');
    await browser.evaluate(`__productionFixture.errors['profiles.list']='PRIVATE_ROSTER_BODY'`);
    await j.tap('Refresh Chats');await loaded();await browser.settle();
    assert.ok((await rows()).some(([,id])=>id==='qa-project-session'));
    assert.equal(await browser.evaluate(`document.querySelectorAll('.chat-read-status').length`),1);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.chatlist [role="alert"]').length`),0);
    assert.equal(await browser.evaluate(`document.body.innerText.includes('PRIVATE_ROSTER_BODY')`),false);
    assert.equal(await browser.evaluate(`document.querySelector('[data-session-id="qa-project-session"] .chat-delete').disabled`),true);
    await browser.evaluate(`delete __productionFixture.errors['profiles.list']`);await j.tap('Retry');await loaded();
  });
  await check('refresh preserves available filters, resets unavailable project instead of hiding retained rows',async()=>{
    await select('Project filter',JSON.stringify(['default','qa-project']));
    browser.readMode='partial';await j.tap('Refresh Chats');await loaded();
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Project filter"]').value`),JSON.stringify(['default','qa-project']));
    browser.readMode='failed';await j.tap('Refresh Chats');await loaded();
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Project filter"]').value`),'');
    assert.ok((await rows()).some(([,id])=>id==='qa-project-session'));
    browser.readMode='ok';await j.tap('Retry');await loaded();
  });
  report.nativeHttp=browser.http;report.expectedNetworkFailures=browser.expectedNetworkFailures;report.fixture=await browser.evaluate(`({trace:__productionFixture.trace,violations:__productionFixture.violations})`);
  await check('no RPC mutation/fallback, diagnostics or outbound request violations',async()=>{
    assert.deepEqual(report.fixture.violations,[]);assert.deepEqual(browser.diagnostics,[]);assert.deepEqual(host.rejected,[]);
    assert.ok(!report.fixture.trace.some(r=>['session.delete','session.create','projects.set_active','config.set','prompt.submit'].includes(r.method)));
    assert.equal(await browser.evaluate(`String(window.fetch).includes('[native code]')`),true);
  });
} catch(error) {report.error=error.stack;}
finally {
  report.dom=await browser.evaluate('document.body.innerText').catch(()=>null);report.diagnostics=browser.diagnostics;
  report.cleanup=await browser.close();host.server.closeAllConnections();await new Promise(resolve=>host.server.close(resolve));report.serverClosed=!host.server.listening;
  report.status=!report.error&&report.checks.every(c=>c.status==='passed')&&report.cleanup.exited&&report.cleanup.profileRemoved&&report.serverClosed?'passed':'failed';
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='failed').map(c=>({name:c.name,error:c.error})),error:report.error,report:path.join(output,'report.json')},null,2));
assert.equal(report.status,'passed');
