import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const output=join(tmpdir(),'hm-shared-projects');await mkdir(output,{recursive:true});
const host=await serveDist('.');
// Fulfill only allowlisted build assets; keep browser outbound interception active.
class Browser extends ProductionBrowser {
 onEvent(event){
  const {method,params,sessionId}=event;
  if(sessionId===this.sessionId && method==='Fetch.requestPaused' && this.allowed(params.request.url) && params.request.method==='GET'){
   void fetch(params.request.url).then(async response=>this.command('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:response.status,responseHeaders:[{name:'Content-Type',value:response.headers.get('content-type') || 'application/octet-stream'}],body:Buffer.from(await response.arrayBuffer()).toString('base64')})).catch(error=>this.diagnostics.push({kind:'fulfill-error',message:error.message}));return;
  }
  super.onEvent(event);
 }
}
const b=new Browser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:90000,timeout:5000});
const report={journeys:[],screenshots:[],layout:[]};
try{
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify({...FIXTURE,preservePreferences:true})});(${domHelpers.toString()})();`});
 await b.open(host.origin);const j=new Journeys(b,report,output);await j.tap(FIXTURE.gateway.label,'body',false);await j.text('QA Project conversation');
 await j.tap('Project actions for QA Project');await j.tap('Edit','[role=menu]');assert.equal(await b.evaluate(`document.querySelector('[aria-label="Project folder"]').disabled`),true);
 await j.type('[aria-label="Project name"]','Shared name');await b.evaluate("__productionFixture.permits['projects.update']=1");await j.tap('Save changes','dialog');await b.waitFor("!document.querySelector('dialog')");await j.text('Shared name');
 assert.equal(await b.evaluate('__productionFixture.projects[0].label'),'Shared name');
 await j.tap('Add project');await j.type('[aria-label="Project folder"]','/fictional/empty');await j.type('[aria-label="Project name"]','Empty shared');await b.evaluate("__productionFixture.permits['projects.create']=1");await j.tap('Add project','dialog',false);await b.waitFor("!document.querySelector('dialog')");await j.text('Empty shared');
 await b.evaluate("__productionFixture.projects[0].label='Desktop rename'");await j.tap('Refresh projects');await j.text('Desktop rename');
 await b.evaluate("__productionFixture.projects.push({id:'__no_project__',label:'Home',isNoProject:true,profile:'default',repos:[{id:'home',groups:[{id:'home',sessions:[{id:'qa-recent-session',profile:'default',title:'QA Recent conversation',message_count:2}]}]}]})");await j.tap('Refresh projects');await b.waitFor("!document.querySelector('[aria-label=\"Refresh projects\"]').disabled");
 assert.equal(await b.evaluate("[...document.querySelectorAll('.tree-project-toggle')].some(e=>e.textContent.includes('Home'))"),false);
 assert.equal(await b.evaluate("!!document.querySelector('.tree-recent [data-session-id=qa-recent-session]')"),true);
 assert.equal(await b.evaluate("document.querySelectorAll('[data-session-id=qa-recent-session]').length"),1);
 await j.shot('shared-projects');
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);
 console.log('PASS gateway create, rename/readback, empty project, Desktop refresh, Home membership; fictional transport only');
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,diagnostics:b.diagnostics,stderr:b.stderr}));throw error;}
finally{await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));}
