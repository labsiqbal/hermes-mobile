import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ProductionBrowser,serveDist,domHelpers,Journeys} from './check-production-browser.mjs';
import {FIXTURE,installProductionFixtures} from './production-browser-fixtures.mjs';
const output=path.join(process.env.TMPDIR || '.', 'hermes-mobile-inbox');await mkdir(output,{recursive:true});
const fixture=structuredClone(FIXTURE);fixture.preservePreferences=true;
fixture.projects=[{id:'qa-project',label:'QA Project',profile:'default',sessionCount:1,previewSessions:[fixture.sessions[0]],repos:[{id:'qa-repo',groups:[{id:'qa-lane',sessions:[fixture.sessions[0]]}]}]}];
const homeRows=Array.from({length:6},(_,i)=>({...fixture.sessions[1],profile:'default',id:`home-${i}`,title:`Home conversation ${i}`,preview:'Fictional inbox preview',started_at:1700000000+i,last_active:1700000010-i,input_tokens:i*100}));
const homeProfiles=['default','builder','reviewer'];
fixture.extraProfiles=homeProfiles.slice(1).map(name=>({name,model:'fixture-model',provider:'fixture',ui_meta:{}}));
const homes=homeProfiles.map(profile=>profile==='default'?homeRows:[{...fixture.sessions[1],profile,id:`home-${profile}`,title:`${profile} Home conversation`,preview:'Fictional inbox preview'}]);
fixture.sessions.push(...homes.flat());
fixture.projects.push(...homes.map((sessions,index)=>({id:'__no_project__',label:'Home',profile:homeProfiles[index],isNoProject:true,sessionCount:sessions.length,previewSessions:sessions.slice(0,3),repos:[{id:'home',groups:[{id:'home',sessions}]}]})));
const host=await serveDist('.');const b=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:90000,timeout:5000,chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const report={journeys:[],screenshots:[],layout:[],checks:[]};
try{
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify(fixture)});(${domHelpers.toString()})();`});
 await b.open(host.origin);const j=new Journeys(b,report,output);await j.tap(fixture.gateway.label,'body',false);
 await b.waitFor("document.querySelectorAll('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').length===6");
 assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.tree-project-toggle')].filter(node=>node.querySelector('span')?.textContent==='Home').map(node=>node.textContent.trim())"),['Home· default','Home· builder','Home· reviewer']);
 assert.equal(await b.evaluate("document.querySelector('.tree-recent')?.innerText.includes('Home conversation') || false"),false);
 assert.equal(await b.evaluate("document.querySelector('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').dataset.sessionId"),'home-0');
 for(const width of [320,390,430]){await b.viewport(width,844);await b.settle();assert.equal(await b.evaluate("(()=>{const toolbar=document.querySelector('.inbox-toolbar').getBoundingClientRect(),view=document.querySelector('.inbox-view-trigger').getBoundingClientRect(),search=document.querySelector('.project-search').getBoundingClientRect();return Math.abs(view.top-search.top)<=1&&search.left-view.right>=12&&view.height>=44&&search.height>=44&&Math.abs(toolbar.width-(view.width+12+search.width))<=1;})()"),true);assert.ok(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));await j.shot('inbox-'+width);}
 await j.shot('inbox-home');await j.tap('View');await j.shot('inbox-menu');
 const select=async(index,value)=>{await b.evaluate(`(()=>{const e=document.querySelectorAll('.inbox-view-dialog select')[${index}];e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await b.settle();};
 await select(1,'created');await j.tap('Close chat view');assert.equal(await b.evaluate("document.querySelector('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').dataset.sessionId"),'home-5');
 await j.tap('View');await select(1,'tokens');await select(0,'profile');await j.tap('Close chat view');
 assert.equal(await b.evaluate("document.querySelectorAll('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').length"),6);
 await j.tap('View');await j.clickCSS('.inbox-switch input');await j.tap('Close chat view');assert.equal(await b.evaluate("!!document.querySelector('.inbox-preview')"),false);
 await b.command('Page.reload');await b.waitFor("document.querySelectorAll('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').length===6");assert.equal(await b.evaluate("!!document.querySelector('.inbox-style')"),false);
 await j.tap('View');await j.tap('Reset to defaults');await j.tap('Close chat view');await j.tap('Home','.tree-project-heading',false);assert.equal(await b.evaluate("document.querySelectorAll('[data-session-id^=home-]:not([data-session-id=home-builder]):not([data-session-id=home-reviewer])').length"),0);await j.tap('Home','.tree-project-heading',false);
 for(const width of [320,390,430]){await b.viewport(width,844);await b.settle();assert.ok(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));await j.shot('inbox-'+width);}
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);
 assert.equal(await b.evaluate("__productionFixture.trace.some(t=>['session.create','session.delete','prompt.submit','projects.set_active'].includes(t.method))"),false);
 report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;report.stderr=b.stderr;report.diagnostics=b.diagnostics;report.dom=await b.evaluate('document.body.innerText').catch(()=>null);}
finally{report.cleanup=await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,error:report.error,output}));if(report.status!=='passed')process.exitCode=1;
