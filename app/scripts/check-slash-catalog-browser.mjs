import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const output=tmpdir()+'/hermes-mobile-slash-evidence';await mkdir(output,{recursive:true});
const host=await serveDist(process.argv[2] || '.');
const b=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:60000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={journeys:[],screenshots:[],layout:[],checks:[]};
try{
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify(FIXTURE)});(${domHelpers.toString()})();`});await b.open(host.origin);
 const j=new Journeys(b,report,output);await j.tap(FIXTURE.gateway.label,'body',false);await j.tap('QA Project conversation','body',false);await b.waitFor('!!document.querySelector("textarea")');
 await j.type('textarea','/');await b.waitFor("document.querySelectorAll('[aria-label=\"Slash commands\"] button').length===69");
 await j.shot('chat-full-catalog');assert.ok(await b.evaluate("document.querySelector('.slash-suggestions').getBoundingClientRect().height<=280"));
 assert.ok(await b.evaluate("document.querySelector('textarea').getBoundingClientRect().bottom<=innerHeight"));
 await b.evaluate("__productionFixture.hold=['slash.exec']");await j.type('textarea','/status');await j.tap('/status','[aria-label="Slash commands"]',false);await j.tap('Send message');await j.text('Running command...');await j.type('textarea','Keep this next draft');await b.evaluate("__productionFixture.release('slash.exec')");await j.text('Fixture runtime status: ready');assert.equal(await b.evaluate("document.querySelector('textarea').value"),'Keep this next draft');
 assert.deepEqual(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='slash.exec').map(t=>t.params.profile)"),['default']);
 await j.type('textarea','/review');await j.tap('Send message');await j.text('execution is not supported here yet');
 for(const command of ['/plugin:review','/tool.run','/skills/review']){await j.type('textarea',command);await j.tap('Send message');await j.text('execution is not supported here yet');}
 assert.equal(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='prompt.submit').length"),0);
 await j.type('textarea','/goal');await j.tap('Send message');await j.text('Fixture goal status: inactive');
 await b.evaluate("__productionFixture.goalResult={type:'send',notice:'Fixture goal activated',message:'Complete fictional goal',display:'/goal resume'};__productionFixture.permits['prompt.submit']=1");
 await j.type('textarea','/goal Complete fictional goal');await j.tap('Send message');await j.text('Fixture goal activated');
 await b.waitFor("__productionFixture.trace.some(t=>t.method==='prompt.submit')");
 assert.equal(await b.evaluate("__productionFixture.trace.find(t=>t.method==='prompt.submit').params.text"),'Complete fictional goal');
 await b.evaluate("__productionFixture.emit('message.complete','qa-project-session',{text:'Fixture goal done'});delete __productionFixture.goalResult");
 await j.tap('Back');await j.root('Bots');await j.tap('QA Fixture Bot','body',false);await j.tap('Bot Chat','body',false);await b.waitFor('!!document.querySelector("textarea")');
 await j.type('textarea','/');await b.waitFor("document.querySelectorAll('[aria-label=\"Slash commands\"] button').length===69");await j.shot('bot-full-catalog');
 assert.ok(await b.evaluate("__productionFixture.trace.some(t=>t.method==='commands.catalog'&&t.params.profile==='qa-bot'&&t.params.session_id==='qa-bot-session')"));
 await j.type('textarea','/status');await j.tap('Send message');await j.text('Fixture runtime status: ready');
 assert.deepEqual(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='slash.exec'&&t.params.command==='/status').map(t=>t.params.profile)"),['default','qa-bot']);
 for(const command of ['/goal status','/goal pause','/goal clear']) {
   await j.type('textarea',command);await j.tap('Send message');await j.text('Fixture goal status: inactive');
 }
 assert.ok(await b.evaluate("__productionFixture.trace.some(t=>t.method==='slash.exec'&&t.params.command==='/goal pause'&&t.params.profile==='qa-bot'&&t.params.session_id==='qa-bot-session')"));
 await b.evaluate("__productionFixture.goalResult={type:'send',message:42}");
 await j.type('textarea','/goal resume');await j.tap('Send message');await j.text('Unsupported goal response');
 assert.equal(await b.evaluate("document.querySelector('textarea').value"),'/goal resume');
 assert.equal(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='prompt.submit').length"),1);
 await b.evaluate("__productionFixture.goalResult={type:'send',notice:'Fixture goal resumed',message:'PRIVATE CONTINUATION',display:'/goal resume'};__productionFixture.permits['prompt.submit']=1;__productionFixture.hold=['slash.exec']");
 await j.tap('Send message');await j.text('Running command...');await j.type('textarea','Keep goal draft');await b.evaluate("__productionFixture.release('slash.exec')");await j.text('Fixture goal resumed');
 await b.waitFor("__productionFixture.trace.filter(t=>t.method==='prompt.submit').length===2");
 assert.equal(await b.evaluate("document.querySelector('textarea').value"),'Keep goal draft');
 assert.equal(await b.evaluate("document.body.innerText.includes('PRIVATE CONTINUATION')"),false);
 assert.deepEqual(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='prompt.submit').map(t=>t.params.text)"),['Complete fictional goal','PRIVATE CONTINUATION']);
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);report.status='passed';
 report.checks.push('Full untruncated scrollable gateway catalog in chat and bot; search/select; profile-bound status execution; unsupported command never sent as prompt');
}catch(e){report.status='failed';report.error=e.stack;try{report.dom=await b.evaluate('document.body.innerText');await b.screenshot(output+'/failure.png');}catch{}}
finally{report.cleanup=await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,error:report.error,output},null,2));if(report.status!=='passed')process.exitCode=1;
