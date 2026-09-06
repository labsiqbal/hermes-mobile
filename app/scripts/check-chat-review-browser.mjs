#!/usr/bin/env node
// Durable correct-outcome regression adapted from the independent review repro.
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ChromePipe} from './production-browser-chrome-pipe.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2] || '/tmp/hm-chat-review-browser');
assert.ok(!output.startsWith(path.join(app,'dist')));mkdirSync(output,{recursive:true});
buildSync({entryPoints:[path.join(app,'scripts/fixtures/chat-review.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent'});
writeFileSync(path.join(output,'fixture.html'),`<!doctype html><div id="root"></div><script>${readFileSync(path.join(output,'fixture.js'),'utf8').replaceAll('</script','<\\/script')}</script>`);
const browser=new ChromePipe({output,deadline:60000});const evidence={checks:[]};
try {
 await browser.start();await browser.open('file://'+path.join(output,'fixture.html'));
 await browser.waitFor("!!document.querySelector('[data-session-id=canonical]')");
 await browser.evaluate("document.querySelector('[data-project-id] .project-group-head').click()");
 await browser.waitFor("!!document.querySelector('[data-project-id] [data-session-id=old-project]')");
 assert.equal(await browser.evaluate("document.querySelectorAll('[data-session-id=old-project]').length"),1);evidence.checks.push('Different overview/hydration horizons do not duplicate Recent');
 await browser.evaluate("document.querySelector('[data-session-id=canonical] .chat-delete').click()");await browser.waitFor("!!document.querySelector('dialog[open]')");await browser.evaluate("document.querySelector('dialog .btn-destructive').click()");await browser.waitFor("!document.querySelector('dialog')");
 assert.equal(await browser.evaluate('fixture.calls.length'),0);evidence.checks.push('Null canonical roster invokes exact lookup and cannot delete protected target');
 await browser.waitFor("!!document.querySelector('[data-session-id=old-project] .chat-delete')");
 await browser.evaluate("document.querySelector('[data-session-id=old-project] .chat-delete').click()");await browser.waitFor("!!document.querySelector('dialog[open]')");
 await browser.evaluate("fixture.state('closed')");await browser.waitFor("!document.querySelector('dialog')");await browser.evaluate("fixture.state('open')");await browser.settle();
 assert.equal(await browser.evaluate("!!document.querySelector('dialog[open]')"),false);assert.equal(await browser.evaluate('fixture.calls.length'),0);evidence.checks.push('Disconnected confirmation cannot survive reconnect');
 await browser.waitFor("!!document.querySelector('[data-session-id=old-project] .chat-delete')");await browser.evaluate("document.querySelector('[data-session-id=old-project] .chat-delete').click()");await browser.waitFor("!!document.querySelector('dialog[open]')");await browser.evaluate("document.querySelector('dialog .btn-destructive').click()");
 await browser.waitFor("fixture.calls.length===1 && !document.querySelector('dialog')");assert.deepEqual(await browser.evaluate('fixture.calls'),[{id:'old-project',profile:'builder'}]);evidence.checks.push('Fresh confirmation deletes only exact named-process owner/session');
 await browser.waitFor("!!document.querySelector('.project-pin')");await browser.evaluate("document.querySelector('.project-pin').click()");
 await browser.evaluate("fixture.switchEndpoint('https://second.invalid')");await browser.waitFor("!!document.querySelector('.project-pin')");assert.equal(await browser.evaluate("document.querySelector('.project-pin').getAttribute('aria-pressed')"),'false');
 await browser.evaluate("fixture.switchEndpoint('https://fixture.invalid')");await browser.waitFor("document.querySelector('.project-pin')?.getAttribute('aria-pressed')==='true'");evidence.checks.push('Same device ID on another endpoint never inherits pins');
 await browser.evaluate("fixture.failHydration();document.querySelector('[aria-label=\"Refresh Chats\"]').click()");await browser.waitFor("document.body.innerText.includes('Showing the verified preview only')");
 assert.equal(await browser.evaluate("document.querySelectorAll('[data-project-id] [data-session-id=new-project]').length"),1);evidence.checks.push('Failed project hydration retains accessible verified preview with warning');
 evidence.diagnostics=browser.diagnostics;assert.deepEqual(evidence.diagnostics,[]);evidence.status='passed';
} catch(error){evidence.status='failed';evidence.error=error.stack;}
finally {await browser.close();evidence.cleanup=browser.cleanup;if(!evidence.cleanup.exited||!evidence.cleanup.profileRemoved)evidence.status='failed';writeFileSync(path.join(output,'report.json'),JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify({status:evidence.status,checks:evidence.checks.length,report:path.join(output,'report.json'),error:evidence.error},null,2));assert.equal(evidence.status,'passed');
