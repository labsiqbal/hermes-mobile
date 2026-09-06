#!/usr/bin/env node
// Real built App with fictional, varied history. No live gateway or fixture mutation permits.
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProductionBrowser, serveDist, domHelpers, Journeys} from './check-production-browser.mjs';
import {FIXTURE, installProductionFixtures} from './production-browser-fixtures.mjs';
const app=path.resolve(process.argv[3] || '.');
const output=path.resolve(process.argv[2] || '/tmp/hm-chats-readability');
await mkdir(output,{recursive:true});
const fixture=structuredClone(FIXTURE);
fixture.gateway.label='Development';
const titles=[
  ['Update the team portraits on the company website','Use the latest approved photographs.'],
  ['Review the September launch checklist','The copy is ready for a final review.'],
  ['Set up Paperclip on the development machine','Keep the existing workspace configuration.'],
  ['A quieter mobile chat list with readable titles','Make room for the conversation names.'],
  ['Check the invoice export before sending it','The totals match the approved worksheet.'],
  ['Plan the customer support handover','Collect the outstanding questions first.'],
  ['Improve the portfolio project descriptions','Keep the tone direct and specific.'],
  ['Compare the new booking page on mobile','The date picker should remain easy to use.'],
  ['Follow up on the product photography','Ask which images are approved for release.'],
  ['Document the staging deployment steps','Leave the production service unchanged.'],
  ['Prepare a short weekly progress summary','Include decisions and the remaining blockers.'],
  ['Review navigation labels in the help centre','Use the same terms across every screen.'],
];
fixture.sessions=Array.from({length:30},(_,i)=>({...fixture.sessions[1],id:`reading-${i}`,title:titles[i%titles.length][0],preview:titles[i%titles.length][1],profile:i===29?'qa-bot':'default',started_at:1788616800-i*10800,message_count:[113,28,62,8,144,4][i%6]}));
fixture.bot={...fixture.bot,preview:'Ready to help with the next task.',started_at:1788616800,message_count:128};
fixture.sessions.push(fixture.bot);
fixture.projects=[['website','Website',fixture.sessions.slice(0,2)],['infra','Infrastructure',fixture.sessions.slice(2,3)],['operations','Operations',fixture.sessions.slice(4,6)]].map(([id,label,rows])=>({id,label,profile:'default',sessionCount:rows.length,previewSessions:rows,repos:[{id:`${id}-repo`,label,groups:[{id:`${id}-group`,label:'main',sessions:rows}]}]}));
const host=await serveDist(app);
const browser=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:180000,timeout:5000,chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const report={evidence:'BUILT-APP-FICTIONAL-CHATS-READABILITY-NOT-PHONE-OR-LIVE',artifact:host.hashes,runnerSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),checks:[],layout:[],screenshots:[]};
const q=JSON.stringify;
const check=async(name,fn)=>{try{await fn();report.checks.push({name,status:'passed'});}catch(e){report.checks.push({name,status:'failed',error:e.stack});}};
// DOM geometry is shared unchanged by RED and GREEN; no candidate-only selector is required.
const measure=`(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const b=document.querySelector('.chatlist'),groups=document.querySelector('.shell-body > .collection-link'),br=rect(b);
  const rows=[...b.querySelectorAll('.chat-session-row')].map(e=>{
    const title=e.querySelector('.rowcard-title'),meta=e.querySelector('.rowcard-meta'),open=e.querySelector('.rowcard'),del=e.querySelector('.chat-delete');
    const style=getComputedStyle(title),dr=rect(del),s=getComputedStyle(del);
    const hit=(el,x,y)=>{const h=document.elementFromPoint(x,y);return el===h||el.contains(h);};
    const visible=dr.top>=br.top&&dr.bottom<=br.bottom;
    return {id:e.dataset.sessionId,profile:e.dataset.profile,row:rect(e),title:rect(title),titleText:title.textContent,titleWhiteSpace:style.whiteSpace,titleLineHeight:parseFloat(style.lineHeight),meta:rect(meta),metaText:meta.textContent,metaFits:meta.scrollWidth<=meta.clientWidth+1,open:rect(open),action:dr,disabled:del.disabled,actionBackground:s.backgroundColor,actionBorder:parseFloat(s.borderTopWidth),hit:!visible||[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]].every(([x,y])=>hit(del,dr.left+dr.width*x,dr.top+dr.height*y))};
  });
  return {width:innerWidth,height:innerHeight,root:rect(document.querySelector('#root')),body:br,scrollTop:b.scrollTop,scrollHeight:b.scrollHeight,groups:rect(groups),header:rect(document.querySelector('header')),tabs:rect(document.querySelector('.shell-tabbar')),rows,headers:[...b.querySelectorAll('.project-group-head')].map(rect),pins:[...b.querySelectorAll('.project-pin')].map(e=>({rect:rect(e),bg:getComputedStyle(e).backgroundColor,border:parseFloat(getComputedStyle(e).borderTopWidth)})),overflow:document.documentElement.scrollWidth>innerWidth};
})()`;
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(${installProductionFixtures.toString()})(${q(fixture)});(${domHelpers.toString()})();`});
  await browser.open(host.origin+'/');const j=new Journeys(browser,report,output);
  await j.tap(fixture.gateway.label,'body',false);
  for(const scale of [75,100,125]) {
    await j.root('Manage');await j.tap('Devices & gateways','body',false);await j.tap('Appearance','body',false);
    await browser.evaluate(`(()=>{const e=document.querySelector('#ui-scale');e.value='${scale}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await browser.settle();await j.tap('Back');await j.root('Chats');
    await browser.waitFor(`document.querySelector('[aria-label="Refresh Chats"]')?.disabled===false`);
    for(const label of ['Website','Infrastructure','Operations']) {
      if(await browser.evaluate(`__qaDOM.find(${q(label)},'.project-heading',false)?.getAttribute('aria-expanded')==='false'`)) await j.tap(label,'.project-heading',false);
    }
    await browser.waitFor(`document.querySelectorAll('.chat-session-row').length===31`);
    for(const width of [320,390,430]) {
      const tag=`${scale}-${width}`;
      await browser.viewport(width,844);await browser.waitFor(`innerWidth===${width}&&document.querySelector('#root').getBoundingClientRect().height===844`);await browser.settle();
      await browser.evaluate(`document.querySelector('.chatlist').scrollTop=0`);await browser.settle();
      const top=await browser.evaluate(measure);report.layout.push({name:`${tag}-top`,...top});await j.shot(`${tag}-top`);
      await check(`${tag}: title-first readable rows; metadata below, no competing columns`,async()=>{
        assert.equal(top.width,width);assert.equal(top.rows.length,31);assert.equal(top.overflow,false);
        for(const r of top.rows) {
          assert.ok(r.title.width>=r.row.width-r.action.width-12,q(r));
          assert.notEqual(r.titleWhiteSpace,'nowrap',q(r));
          assert.ok(r.title.height<=r.titleLineHeight*2+1,q(r));
          assert.ok(r.meta.top>=r.title.bottom&&r.meta.right<=r.open.right+1&&r.metaFits,q(r));
          assert.ok(r.metaText.includes(r.profile)&&r.metaText.includes('msg'),q(r));
          assert.ok(r.row.height<=160&&r.open.height>=44,q(r));
        }
      });
      await check(`${tag}: calm 44px actions and intact section heights`,async()=>{
        for(const r of top.rows) {assert.ok(r.action.width>=44&&r.action.height>=44&&r.action.left>=r.open.right&&r.action.right<=width,q(r));assert.equal(r.actionBackground,'rgba(0, 0, 0, 0)');assert.equal(r.actionBorder,0);}
        for(const p of top.pins) {assert.ok(p.rect.width>=44&&p.rect.height>=44);assert.equal(p.bg,'rgba(0, 0, 0, 0)');assert.equal(p.border,0);}
        assert.ok(top.headers.every(r=>r.height>=44));
      });
      await check(`${tag}: compact Groups preserves list viewport`,async()=>{assert.ok(top.groups.height>=44&&top.groups.height<=Math.max(44,48*scale/100)+1,q(top.groups));});
      await browser.evaluate(`(()=>{const b=document.querySelector('.chatlist'),r=document.querySelector('#recent-sessions').parentElement;b.scrollTop+=r.getBoundingClientRect().top-b.getBoundingClientRect().top-8;})()`);await browser.settle();
      const recent=await browser.evaluate(measure);report.layout.push({name:`${tag}-recent`,...recent});await j.shot(`${tag}-recent`);
      await check(`${tag}: Groups is a normal scroll boundary, not overlaying content`,async()=>{
        assert.equal(top.scrollTop,0);assert.ok(recent.scrollTop>0);assert.deepEqual(recent.groups,top.groups);
        assert.ok(recent.body.top>=recent.groups.bottom&&recent.groups.top>=recent.header.bottom,q(recent));
        assert.ok(recent.body.bottom<=recent.tabs.top+1&&recent.tabs.bottom===844&&recent.header.top>=0,q(recent));
        assert.ok(recent.rows.every(r=>r.hit));
        const rowTop=top.rows.find(r=>r.id==='reading-0').row.top,rowRecent=recent.rows.find(r=>r.id==='reading-0').row.top;
        assert.ok(Math.abs(rowTop-rowRecent-recent.scrollTop)<1,'Rows travel exactly with list scroll; partial rows at edge are expected');
      });
      // Non-row-aligned scroll reproduces a partial row at the top, as in the phone shot.
      await browser.evaluate(`document.querySelector('.chatlist').scrollTop+=79`);await browser.settle();await j.shot(`${tag}-scrolled`);
      await browser.evaluate(`(()=>{const b=document.querySelector('.chatlist');b.scrollTop=b.scrollHeight;})()`);await browser.settle();
      await check(`${tag}: last row reachable with no shell displacement`,async()=>{
        const end=await browser.evaluate(measure);report.layout.push({name:`${tag}-end`,...end});
        const last=end.rows.at(-1);assert.ok(last.row.bottom<=end.body.bottom+1&&last.row.bottom<=end.tabs.top,q(end));assert.ok(last.row.top>=end.body.top&&last.hit,q(last));assert.deepEqual(end.header,top.header);assert.deepEqual(end.tabs,top.tabs);
      });
    }
  }
  await check('canonical and other-profile protection; confirmation can be cancelled',async()=>{
    assert.equal(await browser.evaluate(`document.querySelector('[data-session-id="qa-bot-session"] .chat-delete').disabled`),true);
    assert.equal(await browser.evaluate(`document.querySelector('[data-session-id="reading-29"] .chat-delete').disabled`),true);
    await j.clickCSS('[data-session-id="reading-3"] .chat-delete');await j.text('Delete this session?');await j.text('This cannot be undone.');await j.tap('Cancel','dialog');
    assert.equal(await browser.evaluate(`!!document.querySelector('dialog')`),false);
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.chat-filters select')].map(e=>e.getAttribute('aria-label'))`),['Project filter','Profile filter']);
  });
  report.fixture=await browser.evaluate('({trace:__productionFixture.trace,violations:__productionFixture.violations})');
  await check('no unexpected outbound request or mutation',async()=>{assert.deepEqual(browser.diagnostics,[]);assert.deepEqual(host.rejected,[]);assert.deepEqual(report.fixture.violations,[]);assert.ok(!report.fixture.trace.some(r=>['session.delete','session.create','prompt.submit','config.set','projects.set_active','profiles.configure'].includes(r.method)));});
} catch(e) {report.error=e.stack;report.dom=await browser.evaluate('document.body.innerText').catch(()=>null);}
finally {
  report.diagnostics=browser.diagnostics;report.cleanup=await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));report.serverClosed=!host.server.listening;
  report.status=!report.error&&report.checks.every(c=>c.status==='passed')&&report.cleanup.exited&&report.cleanup.profileRemoved&&report.serverClosed?'passed':'failed';
  await writeFile(path.join(output,'report.json'),q(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='failed').map(c=>c.name),error:report.error,report:path.join(output,'report.json')},null,2));
assert.equal(report.status,'passed');
