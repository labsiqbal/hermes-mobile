import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductionBrowser, serveDist, domHelpers, Journeys } from '../app/scripts/check-production-browser.mjs';
import { FIXTURE, installProductionFixtures } from '../app/scripts/production-browser-fixtures.mjs';

const output = path.dirname(fileURLToPath(import.meta.url));
const host = await serveDist(path.join(output, '../app'));
const browser = new ProductionBrowser({ origin: host.origin, assetPaths: host.assetPaths, output });
const fixture = structuredClone(FIXTURE);
fixture.historyBySession = {
  'qa-project-session': [
    { role: 'user', content: 'Help me prepare a launch checklist for a fictional community garden.' },
    { role: 'assistant', content: '## Community garden launch\n\n- Confirm the planting space and water access.\n- Invite neighbors to a planning afternoon.\n- Choose seasonal seeds and shared tools.\n- Assign a volunteer watering schedule.\n\nStart with one small bed, then expand after the first harvest.' },
  ],
};
try {
  await browser.start();
  await browser.command('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installProductionFixtures.toString()})(${JSON.stringify(fixture)});(${domHelpers.toString()})();`,
  });
  await browser.open(host.origin + '/');
  const j = new Journeys(browser, { screenshots: [], layout: [] }, output);
  await j.tap(fixture.gateway.label, 'body', false);
  await j.text('QA Project conversation');
  await j.tap('QA Project conversation', 'body', false);
  await j.text('Community garden launch');
  await j.type('textarea', 'Turn this into a weekend plan.');
  await browser.evaluate('document.activeElement.blur()');
  await browser.settle();
  await j.shot('conversation');
  await j.tap('Back');
  await j.root('Manage');
  await j.tap('Appearance & preferences', 'body', false);
  await j.text('UI scale');
  await j.shot('appearance');
  assert.deepEqual(await browser.evaluate('__productionFixture.violations'), []);
  assert.deepEqual(browser.diagnostics, []);
  assert.deepEqual(host.rejected, []);
  console.log('Captured conversation and appearance from the built app using fictional data.');
} finally {
  await browser.close();
  await new Promise(resolve => host.server.close(resolve));
}
