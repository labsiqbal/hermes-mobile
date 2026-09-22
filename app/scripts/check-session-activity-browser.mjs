import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ChromePipe} from './production-browser-chrome-pipe.mjs';
const output=join(tmpdir(),`session-activity-browser-${process.pid}`);mkdirSync(output,{recursive:true});
buildSync({entryPoints:['scripts/fixtures/session-activity.tsx'],outfile:join(output,'fixture.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic'});
writeFileSync(join(output,'fixture.html'),`<!doctype html><style>${readFileSync('src/components/session-activity.css','utf8')}</style><div id="root"></div><script>${readFileSync(join(output,'fixture.js'),'utf8').replaceAll('</script','<\\/script')}</script>`);
const browser=new ChromePipe({output,deadline:60000});
try{
 await browser.start();await browser.open('file://'+join(output,'fixture.html'));
 await browser.waitFor("!!document.querySelector('summary')");
 assert.equal(await browser.evaluate("fixture.calls.some(c=>c.method==='subagent.tail')"),false);
 await browser.evaluate("document.querySelector('summary').click()");
 await browser.waitFor("document.body.innerText.includes('Fictional terminal output: PASS')");
 assert.deepEqual(await browser.evaluate("fixture.calls.find(c=>c.method==='subagent.tail').params"),{session_id:'session',subagent_id:'child'});
 await browser.evaluate('fixture.complete()');await browser.waitFor("document.querySelector('summary').innerText.includes('completed')");
 assert.ok(await browser.evaluate("document.body.innerText.includes('Checking fixture')"));
 await browser.evaluate("document.querySelector('summary').click()");await browser.waitFor("!document.querySelector('details').open");
 assert.deepEqual(browser.diagnostics,[]);
 console.log('Browser: expandable log, selected-only scoped tail, completed status, retained activity and collapse passed.');
}finally{await browser.close();}
