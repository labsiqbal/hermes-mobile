import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const output='/tmp/hermes-mobile-project-tree-evidence';await mkdir(output,{recursive:true});
const host=await serveDist(path.resolve(process.argv[2] || '.'));
const b=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:90000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={journeys:[],layout:[],screenshots:[],checks:[]};
try {
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify({...FIXTURE,preservePreferences:true})});(${domHelpers.toString()})();`});
 await b.viewport(1440,900);await b.open(host.origin);const j=new Journeys(b,report,output);
 await j.tap(FIXTURE.gateway.label,'body',false);await j.text('QA Project conversation');
 assert.deepEqual(await b.evaluate("[...document.querySelectorAll('nav[aria-label=Primary] button')].map(e=>e.textContent.trim())"),['Chats','Bots','Cronjobs','Manage']);
 assert.equal(await b.evaluate("getComputedStyle(document.documentElement).colorScheme"),'dark');
 await j.tap('QA Project conversation','.desktop-sidebar',false);await b.waitFor('!!document.querySelector("textarea")');
 assert.equal(await b.evaluate("document.querySelector('.project-session[aria-current=page]')?.dataset.sessionId"),'qa-project-session');
 await j.shot('desktop-chat');
 await j.tap('Add project');await j.type('input[aria-label="Project folder"]','/fictional/qa-project');await j.type('input[aria-label="Project name"]','My project');await j.tap('Add project','dialog',false);await j.text('My project');
 await j.tap('Add project');await j.type('input[aria-label="Project folder"]','/fictional/second');await j.type('input[aria-label="Project name"]','Second project');await j.tap('Add project','dialog',false);
 const hover=async(label)=>{const p=await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await b.command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await b.settle();};
 await b.evaluate("[...document.querySelectorAll('.tree-project-toggle')].find(e=>e.textContent==='Second project').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}))");await b.settle();
 assert.equal(await b.evaluate("document.querySelector('.tree-project-toggle span').textContent"),'Second project');
 await b.command('Page.reload');await b.waitFor("!!document.querySelector('.tree-project-toggle')");await b.settle();
 assert.equal(await b.evaluate("document.querySelector('.tree-project-toggle span').textContent"),'Second project');
 await b.evaluate("document.querySelector('.tree-project-heading').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))");await b.settle();
 await b.evaluate("document.querySelectorAll('.tree-project')[1].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()}))");
 await b.settle();assert.equal(await b.evaluate("document.querySelector('.tree-project-toggle span').textContent"),'My project');
 await b.evaluate("__productionFixture.permits['session.create']=1;__productionFixture.hold=['session.create']");await hover('New session in My project');await j.tap('New session in My project');await b.waitFor("__productionFixture.trace.some(t=>t.method==='session.create')");
 assert.equal(await b.evaluate("[...document.querySelectorAll('.working-folder button')].filter(e=>e.textContent.includes('Starting')||e.textContent==='Start').every(e=>e.disabled)"),true);
 await b.evaluate("__productionFixture.release('session.create')");await b.waitFor("!!document.querySelector('textarea')");await b.settle();
 assert.deepEqual(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='session.create').map(t=>t.params)"),[{cwd:'/fictional/qa-project'}]);
 assert.equal(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='prompt.submit').length"),0);
 report.checks.push('Dark desktop sidebar, nested sessions, selection, add folder, reorder, persistence, single-click exact-folder create without prompt');
 await j.shot('desktop-project-created');
 await hover('Project actions for My project');await j.tap('Project actions for My project');await j.tap('Remove project','[role=menu]',false);await j.text('QA Project');
 assert.equal(await b.evaluate("document.querySelector('[aria-label=\"New session in My project\"]')"),null);
 report.checks.push('Pending create prevents duplicate starts; hiding a project leaves its sessions intact');
 await j.tap('Add project');await j.type('input[aria-label="Project folder"]','/fictional/qa-project');await j.type('input[aria-label="Project name"]','My project');await j.tap('Add project','dialog',false);
 await j.tap('Back');await j.root('Chats');
 for(const width of [320,390]) {
   await b.viewport(width,844);await b.evaluate("(()=>{const b=[...document.querySelectorAll('nav[aria-label=Primary] button')].find(e=>e.textContent.trim()==='Chats');b?.click();})()");await j.text('My project');await j.shot('projects-'+width);
   assert.ok(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));
 }
 await j.tap('Cronjobs','nav[aria-label=Primary]',false);await j.text('QA Fixture Schedule');await j.shot('cronjobs-mobile');
 assert.equal(await b.evaluate("[...document.querySelectorAll('nav[aria-label=Primary] button')].some(e=>e.textContent.trim()==='Home')"),false);
 report.checks.push('Mobile tree fits at 320/390; Cronjobs in bottom destinations; no Home');
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;try{report.dom=await b.evaluate('document.body.innerText');await b.screenshot(path.join(output,'failure.png'));}catch{}}
finally{report.cleanup=await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,error:report.error,checks:report.checks,output},null,2));if(report.status!=='passed')process.exitCode=1;
