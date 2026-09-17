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
  const sessionIds=()=>browser.evaluate(`[...document.querySelectorAll('.project-session')].map(e=>e.getAttribute('data-session-id'))`);
  const leaked=()=>browser.evaluate(`document.body.innerText.includes('PRIVATE_') || document.body.innerText.includes('No state changed.')`);
  await j.tap(fixture.gateway.label,'body',false);await j.root('Chats');await loaded();
  await check('native default ManagementClient dispatches real GETs and reaches project tree',async()=>{
    assert.equal(await browser.evaluate(`String(window.fetch).includes('[native code]')`),true);
    assert.ok(browser.http.some(r=>r.route==='GET /api/sessions'&&r.query.includes('profile=default')));
    assert.ok(browser.http.some(r=>r.route==='GET /api/sessions'&&r.query.includes('profile=qa-bot')));
    assert.ok(await browser.evaluate(`document.body.innerText.includes('QA Project')`));
    assert.deepEqual(await browser.evaluate(`__productionFixture.trace.filter(r=>r.method==='projects.tree').map(r=>r.params.profile).sort()`),['default','qa-bot']);
    assert.ok((await sessionIds()).includes('qa-project-session'));
    assert.ok((await sessionIds()).includes('qa-recent-session'));
  });
  for(const width of [320,360,390,430]) {
    await browser.viewport(width,844);
    await check(`project toolbar 44px; truthful global failure at ${width}`,async()=>{
      const geometry=await browser.evaluate(`(()=>{const buttons=[...document.querySelector('.project-browser').querySelectorAll('button')].filter(e=>__qaDOM.visible(e)).map(e=>{const a=e.getBoundingClientRect();return {label:__qaDOM.label(e),left:a.left,right:a.right,width:a.width,height:a.height}});return {width:innerWidth,buttons};})()`);
      assert.equal(geometry.width,width);
      const named=geometry.buttons.filter(b=>['Refresh projects','Add project','Collapse all folders','Expand all folders'].some(label=>b.label.includes(label)));
      assert.ok(named.length>=2,JSON.stringify(geometry.buttons.map(b=>b.label)));
      assert.ok(named.every(r=>r.height>=44 && r.width>=44 && r.left>=0 && r.right<=width),JSON.stringify(named));
      browser.readMode='failed';await j.tap('Refresh projects');await loaded();
      assert.equal(await leaked(),false);
      assert.ok((await sessionIds()).includes('qa-recent-session'),'Last verified rows retained after refresh failure');
      assert.ok(await browser.evaluate(`document.body.innerText.includes('unavailable') || document.body.innerText.includes('Try refreshing') || !!document.querySelector('.hint,[role="status"],.error-line')`));
      await j.shot(`read-failure-${width}`);browser.readMode='ok';await j.tap('Refresh projects');await loaded();
      assert.ok((await sessionIds()).includes('qa-project-session'));await j.shot(`chats-${width}`);
    });
    browser.readMode='ok';await j.tap('Refresh projects');await loaded();
  }
  await check('partial failure retains verified history and does not leak server bodies',async()=>{
    browser.readMode='partial';await j.tap('Refresh projects');await loaded();
    assert.ok((await sessionIds()).includes('qa-project-session')||(await sessionIds()).includes('qa-recent-session'));
    assert.equal(await leaked(),false);
  });
  await check('cold global failure is not a successful empty list; refresh restores history',async()=>{
    browser.readMode='failed';await j.root('Chats');await j.tap('Refresh projects');await loaded();
    assert.equal(await leaked(),false);assert.equal(await browser.evaluate(`document.body.innerText.includes('No chats match')`),false);
    browser.readMode='ok';await j.tap('Refresh projects');await loaded();assert.ok((await sessionIds()).includes('qa-recent-session'));
  });
  for(const mode of ['auth','html','network']) await check(`sanitized ${mode} read diagnostics`,async()=>{
    browser.readMode=mode;await j.tap('Refresh projects');await loaded();
    assert.equal(await leaked(),false);
    browser.readMode='ok';await j.tap('Refresh projects');await loaded();
  });
  await check('roster failure preserves hydrated history without leaking the roster body',async()=>{
    await j.text('QA Project conversation');
    await browser.evaluate(`__productionFixture.errors['profiles.list']='PRIVATE_ROSTER_BODY'`);
    await j.tap('Refresh projects');await loaded();await browser.settle();
    assert.ok((await sessionIds()).includes('qa-project-session'));
    assert.equal(await leaked(),false);
    await browser.evaluate(`delete __productionFixture.errors['profiles.list']`);await j.tap('Refresh projects');await loaded();
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
