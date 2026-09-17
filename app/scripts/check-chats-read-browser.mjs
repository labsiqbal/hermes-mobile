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
  const loaded=()=>browser.waitFor(`document.querySelector('[aria-label="Refresh projects"]')?.disabled===false`);
  const rows=()=>browser.evaluate(`[...document.querySelectorAll('.project-session')].map(e=>e.dataset.sessionId)`);
  const refresh=async()=>{await j.tap('Refresh projects');await loaded();};
  const unavailable=()=>browser.evaluate(`document.querySelector('.project-browser [role="status"]')?.textContent`);
  await j.tap(fixture.gateway.label,'body',false);await j.root('Chats');await loaded();
  await check('native ManagementClient reads both profiles into the project tree',async()=>{
    assert.equal(await browser.evaluate(`String(window.fetch).includes('[native code]')`),true);
    for(const profile of ['default','qa-bot']) assert.ok(browser.http.some(r=>r.route==='GET /api/sessions'&&r.query.includes('profile='+profile)));
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-folder-id]').length`),1);
    assert.deepEqual(await browser.evaluate(`__productionFixture.trace.filter(r=>r.method==='projects.tree').map(r=>r.params.profile).sort()`),['default','qa-bot']);
    assert.ok((await rows()).includes('qa-owned-other'));
    assert.ok(!(await rows()).includes('qa-bot-session'),'Canonical bot thread stays out of ordinary history');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Delete session QA Other profile history"]').disabled`),true);
  });
  for(const width of [320,360,390,430]) {
    await browser.viewport(width,844);
    await check(`native refresh failure retains history and recovers at ${width}`,async()=>{
      browser.readMode='failed';await refresh();
      assert.equal(await unavailable(),'Some history is unavailable. Refresh to retry.');
      assert.ok((await rows()).includes('qa-recent-session'));
      assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Delete session QA Recent conversation"]').disabled`),true);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('PRIVATE_')`),false);
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`));
      await j.shot(`read-failure-${width}`);
      browser.readMode='ok';await refresh();
      assert.equal(await unavailable(),undefined);
      assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Delete session QA Recent conversation"]').disabled`),false);
      await j.shot(`chats-${width}`);
    });
    browser.readMode='ok';await refresh();
  }
  await check('partial failure retains failed-owner history and protects deletion',async()=>{
    browser.readMode='partial';await refresh();
    assert.ok((await rows()).includes('qa-owned-other'));
    assert.equal(await unavailable(),'Some history is unavailable. Refresh to retry.');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Delete session QA Other profile history"]').disabled`),true);
    browser.readMode='ok';await refresh();
  });
  await check('cold failure reports unavailable history and refresh restores rows',async()=>{
    browser.readMode='failed';await browser.open(host.origin+'/');
    await j.tap(fixture.gateway.label,'body',false);await j.root('Chats');await loaded();
    assert.equal(await unavailable(),'Some history is unavailable. Refresh to retry.');
    assert.deepEqual(await rows(),[]);
    browser.readMode='ok';await refresh();assert.ok((await rows()).includes('qa-recent-session'));
  });
  for(const mode of ['auth','html','network']) await check(`sanitized ${mode} failure and recovery`,async()=>{
    browser.readMode=mode;await refresh();
    assert.equal(await unavailable(),'Some history is unavailable. Refresh to retry.');
    assert.equal(await browser.evaluate(`document.body.innerText.includes('PRIVATE_')`),false);
    assert.ok((await rows()).includes('qa-recent-session'));
    browser.readMode='ok';await refresh();assert.equal(await unavailable(),undefined);
  });
  await check('roster failure preserves hydrated history with a sanitized error',async()=>{
    await j.text('QA Project conversation');
    await browser.evaluate(`__productionFixture.errors['profiles.list']='PRIVATE_ROSTER_BODY'`);
    await refresh();
    assert.ok((await rows()).includes('qa-project-session'));
    assert.equal(await browser.evaluate(`document.querySelectorAll('.project-browser [role="alert"]').length`),1);
    assert.match(await browser.evaluate(`document.querySelector('.project-browser [role="alert"]').textContent`),/refresh/i);
    assert.equal(await browser.evaluate(`document.body.innerText.includes('PRIVATE_ROSTER_BODY')`),false);
    await browser.evaluate(`delete __productionFixture.errors['profiles.list']`);await refresh();
    assert.equal(await browser.evaluate(`document.querySelector('.project-browser [role="alert"]')`),null);
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
