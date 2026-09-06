#!/usr/bin/env node
// Narrow HM-UX-09: real built App and native Chrome controls; fictional transport only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';
const output=path.resolve(process.argv[2] || '/tmp/hmux09-candidate/browser');
await mkdir(output,{recursive:true});
const host=await serveDist(path.resolve('.'));
const browser=new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:180000,timeout:5000,chrome:'/usr/bin/google-chrome'});
const report={evidence:'BUILT-APP-FICTIONAL-HMUX09',checks:[],layout:[],screenshots:[],artifact:host.hashes};
const q=JSON.stringify;
const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`const kept=Object.entries(localStorage).filter(([k])=>k==='hermes-mobile.ui-scale'||k==='unrelated-app');(${installProductionFixtures.toString()})(${q(FIXTURE)});kept.forEach(([k,v])=>localStorage.setItem(k,v));(${domHelpers.toString()})();`});
  await browser.open(host.origin+'/');
  const j=new Journeys(browser,report,output);
  const resize=async w=>{await browser.viewport(w,844);await browser.waitFor(`innerWidth===${w}&&document.querySelector('#root').getBoundingClientRect().height===844`);await browser.settle();};
  const settings=async()=>{await j.root('Manage');await j.tap('Devices & gateways','body',false);};
  const appearance=async()=>{await settings();await j.tap('Appearance','body',false);await browser.waitFor('location.hash==="#appearance"');};
  const change=async(selector,value)=>{await browser.evaluate(`(()=>{const e=document.querySelector(${q(selector)});const set=Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;set.call(e,${q(String(value))});e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await browser.settle();};
  const key=async(key,code,virtual)=>{await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual});await browser.settle();};
  const audit=async tag=>{
    const m=await browser.evaluate(`(()=>{const selects=[...document.querySelectorAll('select')].filter(__qaDOM.visible);return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,headers:[...document.querySelectorAll('header')].filter(__qaDOM.visible).map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})),selects:selects.map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),c=document.createElement('canvas').getContext('2d');c.font=s.font;return {label:e.getAttribute('aria-label'),text:e.selectedOptions[0]?.text,appearance:s.appearance,image:s.backgroundImage,position:s.backgroundPosition,size:s.backgroundSize,paddingRight:parseFloat(s.paddingRight),paddingLeft:parseFloat(s.paddingLeft),font:parseFloat(s.fontSize),width:r.width,height:r.height,left:r.left,right:r.right,textWidth:c.measureText(e.selectedOptions[0]?.text||'').width,available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)};})};})()`);
    report.layout.push({tag,...m});
    await j.shot(tag);
    await check(tag,async()=>{
      assert.equal(m.overflow,false);assert.equal(m.headers.length,1);assert.equal(m.headers[0].top,0);assert.ok(m.selects.length);
      for(const s of m.selects){assert.equal(s.appearance,'none');assert.match(s.image,/data:image\/svg\+xml/);assert.match(s.position,/100% - (12|15)px/);assert.ok(s.paddingRight>=32&&s.font>=16&&s.height>=44&&s.left>=0&&s.right<=m.width,q(s));assert.ok(s.available>=s.textWidth-1,q(s));}
    });
  };
  await j.tap(FIXTURE.gateway.label,'body',false);
  await resize(390);
  await settings();
  await check('Settings only exposes Appearance submenu',async()=>{assert.equal(await browser.evaluate('!!document.querySelector("#ui-scale")||!!document.querySelector(".scratch-accent")'),false);});
  await browser.evaluate(`__qaDOM.find('Appearance','body',false).scrollIntoView({block:'center'})`);await browser.settle();await j.shot('settings-submenu-100-390');
  await j.tap('Appearance','body',false);
  await check('Appearance shared header and existing choices',async()=>{assert.equal(await browser.evaluate('document.querySelector("header h1").textContent'),'Appearance');assert.deepEqual(await browser.evaluate('[...document.querySelector("#ui-scale").options].map(e=>e.text)'),['75% Compact','100% Standard','125% Large']);assert.equal(await browser.evaluate('!!document.querySelector(".shell-tabbar")'),false);});
  await j.back();assert.equal(await browser.evaluate('location.hash'),'#settings');await j.back(1);assert.equal(await browser.evaluate('location.hash'),'#appearance');await j.tap('Back');assert.equal(await browser.evaluate('location.hash'),'#settings');
  report.checks.push({name:'Native Back/Forward and shared header Back restore Settings',status:'passed'});
  for(const scale of [75,100,125]) {
    await appearance();await change('#ui-scale',scale);
    assert.equal(await browser.evaluate('localStorage.getItem("hermes-mobile.ui-scale")'),String(scale));
    for(const width of [320,390]) {
      await resize(width);await appearance();await audit(`appearance-${scale}-${width}`);
      await j.root('Chats');await browser.waitFor(`document.querySelector('[aria-label="Refresh Chats"]')?.disabled===false`);await j.tap('Filter chats');await audit(`chats-selects-${scale}-${width}`);await j.tap('Done');
      await j.root('Manage');if(await browser.evaluate(`!!__qaDOM.find('Back to Manage')`))await j.tap('Back to Manage');await j.tap('Capabilities','.manage',false);await browser.waitFor('document.querySelector("select")?.options.length>1');await audit(`manage-select-${scale}-${width}`);await j.tap('Back to Manage');
      await j.root('Cronjobs');await browser.waitFor('document.querySelector("select")?.options.length>1');await audit(`cronjobs-select-${scale}-${width}`);
    }
  }
  await resize(390);await appearance();await change('#ui-scale',100);
  await browser.evaluate('document.querySelector("#ui-scale").focus()');await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);
  await check('native keyboard select change persists Large',async()=>assert.equal(await browser.evaluate('localStorage.getItem("hermes-mobile.ui-scale")'),'125'));
  const ax=await browser.command('Accessibility.getFullAXTree');
  await check('scale retains accessible native combobox',async()=>assert.ok(ax.nodes.some(n=>n.role?.value==='combobox'&&n.name?.value==='UI scale')));
  await j.clickCSS('input[type="checkbox"]');
  await change('input[type="color"]','#aa66cc');
  const accent=()=>browser.evaluate('document.documentElement.style.getPropertyValue("--scratch-accent")');
  assert.equal(await accent(),'#aa66cc');await j.tap('Back');await j.tap('Appearance','body',false);assert.equal(await accent(),'#aa66cc');
  await j.tap('Restore authored defaults');assert.equal(await accent(),'');assert.equal(await browser.evaluate('document.querySelector("#ui-scale").value'),'125');
  await change('input[type="color"]','#aa66cc');
  await browser.open(host.origin+'/');await browser.waitFor('document.documentElement.dataset.uiScale==="125"');assert.equal(await accent(),'');
  report.checks.push({name:'accent operations/reset stay temporary; scale survives reload',status:'passed'});
  await j.tap(FIXTURE.gateway.label,'body',false);await appearance();
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  assert.deepEqual(await browser.evaluate('({appearance:getComputedStyle(document.querySelector("#ui-scale")).appearance,image:getComputedStyle(document.querySelector("#ui-scale")).backgroundImage})'),{appearance:'auto',image:'none'});
  await browser.command('Emulation.setEmulatedMedia',{features:[]});
  report.checks.push({name:'forced colors restores platform arrow',status:'passed'});
  await j.tap('Back');await browser.evaluate('localStorage.setItem("unrelated-app","keep")');await j.tap('Erase Hermes Mobile data');await j.tap('Erase & reload');await browser.waitFor('document.documentElement.dataset.uiScale==="100"');
  assert.equal(await browser.evaluate('localStorage.getItem("hermes-mobile.ui-scale")'),null);assert.equal(await browser.evaluate('localStorage.getItem("unrelated-app")'),'keep');
  report.checks.push({name:'existing Settings erase resets scale, preserves unrelated storage',status:'passed'});
  report.fixture=await browser.evaluate('({trace:__productionFixture.trace,violations:__productionFixture.violations})');
  await check('no unexpected outbound or runtime mutation',async()=>{assert.deepEqual(browser.diagnostics,[]);assert.deepEqual(host.rejected,[]);assert.deepEqual(report.fixture.violations,[]);assert.ok(!report.fixture.trace.some(t=>['config.set','prompt.submit','profiles.configure','session.create','session.delete'].includes(t.method)));});
  report.status='passed';
} catch(e){report.status='failed';report.error=e.stack;report.dom=await browser.evaluate('document.body.innerText').catch(()=>null);}
finally {report.diagnostics=browser.diagnostics;report.cleanup=await browser.close();host.server.closeAllConnections();await new Promise(r=>host.server.close(r));report.serverClosed=!host.server.listening;if(!report.cleanup.exited||!report.cleanup.profileRemoved||!report.serverClosed)report.status='failed';await writeFile(path.join(output,'report.json'),q(report)+'\n');}
console.log(q({status:report.status,checks:report.checks.length,error:report.error,report:path.join(output,'report.json')}));
assert.equal(report.status,'passed');
