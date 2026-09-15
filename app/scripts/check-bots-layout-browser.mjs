import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';
const output='/tmp/hermes-mobile-bots-layout-evidence'; await mkdir(output,{recursive:true});
const host=await serveDist(process.argv[2]||'.');
const b=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:90000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={journeys:[],screenshots:[],layout:[],checks:[]};
try {
 await b.start();await b.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${JSON.stringify(FIXTURE)});(${domHelpers.toString()})();`});await b.open(host.origin);
 const j=new Journeys(b,report,output);await j.tap(FIXTURE.gateway.label,'body',false);
 const root=async label=>{await j.clickCSS(`nav[aria-label="Primary"] button:nth-child(${['Chats','Bots','Cronjobs','Manage'].indexOf(label)+1})`);await b.waitFor(`__qaDOM.find(${JSON.stringify(label)},'nav[aria-label="Primary"]').classList.contains('active')`);};
 for(const width of [320,390,1440]) {
  await b.viewport(width,900);await root('Bots');await j.text('QA Fixture Bot');
  const tools=await b.evaluate(`(()=>{const a=document.querySelector('[aria-label="Add bot"]').getBoundingClientRect(),r=document.querySelector('[aria-label="Refresh bots"]').getBoundingClientRect();return {dy:Math.abs(a.top-r.top),apart:a.left>=r.right};})()`);
  assert.ok(tools.dy<1&&tools.apart);await j.shot('bots-'+width);
  await j.tap('QA Fixture Bot','body',false);await j.text('Bot Chat');
  const layout=await b.evaluate(`(()=>{const bar=document.querySelector('.bot-threads .chat-section-bar'),h=bar.querySelector('h3').getBoundingClientRect(),b=bar.querySelector('button').getBoundingClientRect(),row=document.querySelector('.bot-thread-row'),title=row.querySelector('strong').getBoundingClientRect(),time=row.querySelector('time').getBoundingClientRect(),preview=row.querySelector('.rowcard-sub').getBoundingClientRect();return {toolbar:Math.abs(h.top+h.height/2-b.top-b.height/2)<2,gap:time.left-title.right,preview:preview.top>=title.bottom,overflow:row.scrollWidth>row.clientWidth};})()`);
  assert.ok(layout.toolbar&&layout.gap>=15&&layout.preview&&!layout.overflow,JSON.stringify(layout));await j.shot('threads-'+width);
  await j.tap('Back');await root('Manage');if(await b.evaluate("!!__qaDOM.find('Back to Manage')"))await j.tap('Back to Manage');
  await j.tap('Appearance & preferences','body',false);await j.text('UI scale');
  assert.equal(await b.evaluate("!!document.querySelector('.manage .appearance-controls')"),true);
  assert.equal(await b.evaluate("document.body.innerText.includes('not implemented in Manage')"),false);
  await j.shot('appearance-'+width);
  assert.ok(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await j.tap('Back to Manage');
 }
 await j.tap('Appearance & preferences','body',false);
 await b.evaluate(`(()=>{const e=document.querySelector('#ui-scale');e.value='75';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await b.settle();
 await j.tap('Back to Manage');await j.tap('Appearance & preferences','body',false);
 assert.equal(await b.evaluate("document.querySelector('#ui-scale').value"),'75');
 await b.evaluate(`(()=>{const e=document.querySelector('#ui-scale');e.value='100';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await j.tap('Connection settings','body',false);
 assert.equal(await b.evaluate("!!__qaDOM.find('Appearance','body',true)"),false);
 assert.deepEqual(await b.evaluate('__productionFixture.violations'),[]);assert.deepEqual(b.diagnostics,[]);
 report.status='passed';report.checks.push('Aligned bot/threads toolbars; separated title/date/preview at 320/390/1440; Appearance controls in Manage; scale persists; old Settings link removed');
}catch(error){report.status='failed';report.error=error.stack;try{report.dom=await b.evaluate('document.body.innerText');await b.screenshot(output+'/failure.png');}catch{}}
finally{report.cleanup=await b.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,error:report.error,output},null,2));if(report.status!=='passed')process.exitCode=1;
