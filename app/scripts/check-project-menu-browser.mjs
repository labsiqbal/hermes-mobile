import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const output='/tmp/hermes-mobile-project-menu-evidence';await mkdir(output,{recursive:true});
const host=await serveDist(process.argv[2] || '.');
const b=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:90000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={journeys:[],screenshots:[],layout:[],checks:[]};
try{
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify({...FIXTURE,preservePreferences:true})});(${domHelpers.toString()})();`});
 await b.open(host.origin);const j=new Journeys(b,report,output);await j.tap(FIXTURE.gateway.label,'body',false);await j.text('QA Project conversation');
 assert.equal(await b.evaluate("document.querySelector('.tree-project-toggle svg').classList.contains('lucide-folder-open')"),true);
 await j.tap('QA Project','.tree-project-heading',false);assert.equal(await b.evaluate("document.querySelector('.tree-project-toggle svg').classList.contains('lucide-folder')"),true);await j.tap('QA Project','.tree-project-heading',false);
 await j.tap('Project actions for QA Project');await b.waitFor("!!document.querySelector('.project-popover:popover-open')");await j.shot('menu-mobile');
 assert.equal(await b.evaluate("document.querySelector('.project-popover').innerText.includes('Move up')"),false);
 await j.tap('Pin','[role=menu]',true);await j.tap('Project actions for QA Project');await j.tap('Edit','[role=menu]');await j.type('input[aria-label="Project name"]','Renamed project');await j.tap('Save changes','dialog');await j.text('Renamed project');
 await j.tap('Project actions for Renamed project');await j.tap('Connection color...','[role=menu]');await j.tap('Blue','[role=menu]');
 await j.tap('Project actions for Renamed project');await j.tap('Edit','[role=menu]');await j.type('input[aria-label="Project folder"]','/fictional/qa-project/new');await j.tap('Save changes','dialog');
 assert.equal(await b.evaluate("document.querySelectorAll('.tree-project').length"),1);
 await j.tap('Project actions for Renamed project');await j.tap('Edit','[role=menu]');await j.type('input[aria-label="Project folder"]','/fictional/qa-project');await j.tap('Save changes','dialog');
 await j.tap('Delete session QA Recent conversation');await j.tap('Cancel','dialog');assert.equal(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='session.delete').length"),0);
 await j.tap('Delete session QA Recent conversation');await b.evaluate("__productionFixture.permits['session.delete']=1");await j.tap('Delete','dialog');await b.waitFor("!document.querySelector('[data-session-id=qa-recent-session]')");assert.equal(await b.evaluate("__productionFixture.trace.filter(t=>t.method==='session.delete').length"),1);
 await j.tap('Project actions for Renamed project');await j.tap('Unpin','[role=menu]');
 await j.tap('Add project');await j.type('input[aria-label="Project folder"]','/fictional/second');await j.type('input[aria-label="Project name"]','Second');await j.tap('Add project','dialog',false);
 const before=await b.evaluate("[...document.querySelectorAll('.tree-project')].map(e=>e.dataset.folderId)");
 const start=await b.evaluate("(()=>{const r=document.querySelector('.tree-project-toggle').getBoundingClientRect();return {x:r.x+20,y:r.y+20};})()");
 await b.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 await b.evaluate("new Promise(r=>setTimeout(r,400))");
 const point=await b.evaluate("(()=>{const r=document.querySelectorAll('.tree-project-heading')[1].getBoundingClientRect();return {x:r.x+20,y:r.y+20};})()");
 await b.command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});await b.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await b.settle();
 const after=await b.evaluate("[...document.querySelectorAll('.tree-project')].map(e=>e.dataset.folderId)");assert.deepEqual(after,[before[1],before[0]]);
 await b.evaluate("document.querySelector('.project-browser').style.maxHeight='160px'");await b.settle();
 const swipe=await b.evaluate("(()=>{const e=document.querySelector('.project-browser');e.scrollTop=100;const r=document.querySelector('.tree-project-toggle').getBoundingClientRect();return {x:r.x+20,y:r.y+12};})()");
 const scrollBefore=await b.evaluate("document.querySelector('.project-browser').scrollTop");
 await b.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[swipe]});await b.command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:swipe.x,y:swipe.y+30}]});await b.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await b.settle();
 assert.ok(await b.evaluate(`document.querySelector('.project-browser').scrollTop<${scrollBefore}`));
 assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.tree-project')].map(e=>e.dataset.folderId)"),after);
 await b.evaluate("document.querySelector('.project-browser').style.maxHeight='';document.querySelector('.project-browser').scrollTop=0");
 for(const width of [320,390]){await b.viewport(width,844);await b.settle();await j.shot('tree-'+width);assert.ok(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));}
 await b.evaluate("[...document.querySelectorAll('nav[aria-label=Primary] button')].find(e=>e.textContent.trim()==='Cronjobs').click()");await j.text('QA Fixture Schedule');await j.shot('cronjobs-spacing');
 await b.viewport(1440,900);await b.waitFor("!!document.querySelector('.desktop-sidebar')");await b.settle();await b.evaluate("[...document.querySelectorAll('nav[aria-label=Primary] button')].find(e=>e.textContent.trim()==='Chats').click()");await j.shot('desktop-tree');
 report.checks.push('Folder open/closed icons; anchored menu pin/edit/color; cancel and exact confirmed deletion; touch reorder; mobile padding');
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;try{report.dom=await b.evaluate('document.body.innerText');await b.screenshot(output+'/failure.png');}catch{}}
finally{report.cleanup=await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,error:report.error,output},null,2));if(report.status!=='passed')process.exitCode=1;
