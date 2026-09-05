#!/usr/bin/env node
// Bounded built-App regression seam; same mandatory journeys also run in the full gate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductionBrowser, serveDist, domHelpers, Journeys, checkNavigationRegressions } from './check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from './production-browser-fixtures.mjs';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : mkdtempSync(path.join(tmpdir(), 'hm-shell-navigation-'));
assert.ok(output !== path.join(app,'dist') && !output.startsWith(path.join(app,'dist') + path.sep));
await mkdir(output, {recursive:true});
const host = await serveDist(app);
const browser = new ProductionBrowser({origin:host.origin,assetPaths:host.assetPaths,output,deadline:60000,timeout:5000,chrome:process.env.CHROME_BIN || '/usr/bin/google-chrome'});
const report = {evidence:'BUILT-REACT-FICTIONAL-TRANSPORT-NAVIGATION-REGRESSION',journeys:[],layout:[],screenshots:[],artifact:host.hashes};
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument', {source:`(${installProductionFixtures.toString()})(${JSON.stringify(FIXTURE)});(${domHelpers.toString()})();`});
  await browser.open(host.origin + '/');
  const j = new Journeys(browser, report, output);
  const fixture = expression => browser.evaluate(`(()=>{const f=__productionFixture;${expression}})()`);
  const trace = () => fixture('return f.trace');
  await j.tap(FIXTURE.gateway.label, 'body', false);
  await j.text('QA Project conversation');
  await checkNavigationRegressions(j, browser, fixture, trace);
  report.fixture = await fixture('return {trace:f.trace,violations:f.violations}');
  assert.deepEqual(report.journeys.map(({id,status})=>({id,status})), [
    {id:'created-session-navigation',status:'passed'}, {id:'manage-navigation-context',status:'passed'},
  ]);
  assert.deepEqual(report.fixture.violations, []);
  assert.equal(report.fixture.trace.filter(t=>t.method==='session.create').length, 1);
  assert.ok(!report.fixture.trace.some(t=>['prompt.submit','session.steer','session.interrupt','profiles.configure','approval.respond'].includes(t.method)));
  assert.deepEqual(browser.diagnostics, []);
  assert.deepEqual(host.rejected, []);
  report.status = 'passed';
} catch(error) { report.status='failed';report.error=error.stack; }
finally {
  report.diagnostics = browser.diagnostics;
  report.cleanup = await browser.close();
  host.server.closeAllConnections();await new Promise(resolve=>host.server.close(resolve));
  report.serverClosed = !host.server.listening;
  if (!report.cleanup.exited || !report.cleanup.profileRemoved || !report.serverClosed) report.status='failed';
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json'),error:report.error,journeys:report.journeys,cleanup:report.cleanup},null,2));
assert.equal(report.status,'passed');
