#!/usr/bin/env node
/** Extra offline UI journeys. Run beside check-prototype.mjs; no packages/ports.
 * Example: node app/scripts/check-prototype-extended.mjs --root /absolute/repo
 * Optional --output /absolute/evidence writes extended-report.json.
 * Scope: local prototype UI only; never gateway/runtime parity.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ChromePipe, click } from './check-prototype.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node app/scripts/check-prototype-extended.mjs --root /absolute/repo [--output /absolute/evidence]');
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i++) {
  assert.ok(['--root', '--output'].includes(args[i]), `Unknown argument: ${args[i]}`);
  const name = args[i].slice(2);
  assert.ok(args[i + 1] && path.isAbsolute(args[i + 1]), `${args[i]} requires an absolute path`);
  options[name] = args[++i];
}
assert.ok(options.root, '--root is required');
if (options.output) await mkdir(options.output, { recursive: true });
const report = {
  schema_version: 1,
  type: 'offline-prototype-extended-ui-checks',
  root: options.root,
  checks: [],
  routeCases: 0,
  palettePointerRoutes: 0,
  limitations: [
    'Headless Chrome UI fixtures only, not live gateway or runtime parity.',
    'Pointer events are dispatched through Chrome; native selects use public change events.',
    'No real phone keyboard, assistive technology, background execution or contrast certification.',
    'Network diagnostics cover the attached page, not an OS-level egress sandbox.',
  ],
};
const browser = new ChromePipe({ output: options.output || tmpdir(), deadline: 240000 });
const evaluate = source => browser.evaluate(source);
const qa = name => `[data-qa="${name}"]`;
const control = name => click(browser, qa(name));
const routeIs = async route => assert.equal(await evaluate('location.hash'), '#' + route);
const inputValue = () => evaluate('document.querySelector("[data-qa=composer]").value');
const fresh = async url => {
  // A different hash is same-document navigation; it must NOT be used as reset.
  await browser.command('Page.navigate', { url: 'about:blank' });
  await browser.settle();
  await browser.open(url);
};
const key = async (name, modifiers = 0) => {
  const code = name === 'Escape' ? 27 : 9;
  await browser.command('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
  await browser.command('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
};
const mode = async value => {
  await evaluate(`(() => { const e = document.querySelector('[data-qa="state-select"]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await browser.settle();
};
const run = async (scope, work) => {
  try { await work(); report.checks.push({ scope, status: 'passed' }); }
  catch (error) { report.checks.push({ scope, status: 'failed', detail: error.message }); }
};

try {
  const manifest = JSON.parse(await readFile(path.join(options.root, 'design/parity-routes.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(manifest.variants.map(v => v.id).sort(), ['shell', 'workspace']);
  await browser.start();
  report.browser = browser.version;
  for (const variant of manifest.variants) {
    const entryPath = path.resolve(options.root, variant.entry);
    assert.ok(entryPath.startsWith(path.resolve(options.root) + path.sep), 'entry remains in root');
    const entry = pathToFileURL(entryPath).href;
    for (const [width, height] of [[390, 844], [320, 844], [430, 844], [844, 390]]) {
      await browser.viewport(width, height);
      // Independent sizing fixtures: accumulating hash changes + popstate replaceState
      // across all viewports triggers Chromium's navigation flood protection.
      await fresh(entry + '#home');
      for (const route of manifest.routes) {
        report.routeCases++;
        await run(`${variant.id}/route/${route.id}/${width}x${height}`, async () => {
          await evaluate('location.hash = ' + JSON.stringify(route.id));
          await browser.waitFor(`location.hash === ${JSON.stringify('#' + route.id)} && window.__prototype.getState().route === ${JSON.stringify(route.id)} && !!document.querySelector('main') && !!document.querySelector('h1')?.textContent.trim()`);
          await browser.settle();
          const result = await evaluate(`(() => {
            const targets = [...document.querySelectorAll('a[href],button,input,textarea,select,summary')].filter(e => e.checkVisibility());
            return {
              route: location.hash,
              overflow: document.documentElement.scrollWidth - innerWidth,
              small: targets.map(e => ({ label: e.getAttribute('aria-label') || e.textContent.slice(0, 60), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })).filter(r => r.width < 43.99 || r.height < 43.99),
              bottomNav: !!document.querySelector('[data-bottom-nav]'),
              heading: document.querySelector('h1')?.textContent,
            };
          })()`);
          assert.equal(result.route, '#' + route.id);
          assert.ok(result.heading?.length, 'route has a heading');
          assert.ok(result.overflow <= 1, JSON.stringify(result));
          assert.deepEqual(result.small, [], '44px targets');
          if (variant.id === 'workspace') assert.equal(result.bottomNav, false);
        });
      }
    }
    await browser.viewport(390, 844);
    await run(`${variant.id}/resume`, async () => {
      await fresh(entry + '#home'); await control('resume'); await routeIs('chat');
    });
    await run(`${variant.id}/multiline-draft-files-preview-git-and-scroll`, async () => {
      await fresh(entry + '#chat'); await control('composer');
      const draft = 'First line\nSecond line\nKeep this unsent.';
      await browser.command('Input.insertText', { text: draft });
      assert.equal(await inputValue(), draft);
      await evaluate('document.querySelector("main").scrollTop = 60');
      const scroll = await evaluate('document.querySelector("main").scrollTop');
      assert.ok(scroll > 0, 'fixture exercises nonzero transcript scroll');
      await control('open-files'); await routeIs('files');
      await control('open-preview'); await routeIs('preview');
      await control('back'); await routeIs('files');
      await control('back'); await routeIs('chat');
      assert.equal(await inputValue(), draft);
      assert.equal(await evaluate('document.querySelector("main").scrollTop'), scroll);
      await control('open-git'); await routeIs('git');
      await control('back'); await routeIs('chat');
      assert.equal(await inputValue(), draft);
      assert.equal(await evaluate('document.querySelector("main").scrollTop'), scroll);
    });
    const palette = async route => {
      await control('command-palette'); await click(browser, `dialog a[href="#${route}"]`); await routeIs(route);
    };
    const nativeHistory = async offset => {
      const history = await browser.command('Page.getNavigationHistory');
      const target = history.entries[history.currentIndex + offset];
      assert.ok(target, 'native browser history destination exists');
      await browser.command('Page.navigateToHistoryEntry', { entryId: target.id });
      await browser.waitFor('location.href === ' + JSON.stringify(target.url));
      await browser.settle();
    };
    await run(`${variant.id}/history-restores-conversation-draft-scroll`, async () => {
      await fresh(entry + '#home'); await control('resume'); await control('composer');
      await browser.command('Input.insertText', { text: 'FIELD draft' });
      await evaluate('document.querySelector("main").scrollTop = 60');
      const fieldScroll = await evaluate('document.querySelector("main").scrollTop');
      assert.ok(fieldScroll > 0);
      await palette('bots'); await control('bot-chat'); await control('composer');
      await browser.command('Input.insertText', { text: 'MIRA draft' });
      await evaluate('document.querySelector("main").scrollTop = 100');
      const miraScroll = await evaluate('document.querySelector("main").scrollTop');
      assert.ok(miraScroll > 0);
      await control('back'); await routeIs('bots');
      await nativeHistory(-1); await routeIs('chat');
      assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Field notes');
      assert.equal(await inputValue(), 'FIELD draft');
      assert.equal(await evaluate('document.querySelector("main").scrollTop'), fieldScroll);
      await nativeHistory(1); await routeIs('bots');
      await nativeHistory(1); await routeIs('chat');
      assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Mira');
      assert.equal(await inputValue(), 'MIRA draft');
      assert.equal(await evaluate('document.querySelector("main").scrollTop'), miraScroll);
      // A context change on this entry must not replace earlier entries' identity.
      await control('context-switcher'); await control('context-harbor');
      await control('composer'); await browser.command('Input.insertText', { text: 'HARBOR draft' });
      await nativeHistory(-1); await nativeHistory(-1);
      assert.match(await evaluate('document.querySelector("[data-qa=context-switcher]").textContent'), /Atlas.*studio/s);
      assert.equal(await inputValue(), 'FIELD draft');
      await nativeHistory(1); await nativeHistory(1);
      assert.match(await evaluate('document.querySelector("[data-qa=context-switcher]").textContent'), /Harbor.*research/s);
      assert.equal(await inputValue(), 'HARBOR draft');
    });
    await run(`${variant.id}/direct-preview-back-climbs-parents`, async () => {
      await fresh(entry + '#preview');
      const before = await browser.command('Page.getNavigationHistory');
      for (const parent of ['files', 'chat', 'chats']) {
        await control('back'); await routeIs(parent);
        const after = await browser.command('Page.getNavigationHistory');
        assert.equal(after.entries.length, before.entries.length, 'synthetic parent does not push a child into history');
        assert.equal(after.currentIndex, before.currentIndex);
      }
      if (variant.id === 'workspace') { await control('back'); await routeIs('home'); }
    });
    await run(`${variant.id}/session-model-isolated-by-gateway-profile-and-chat`, async () => {
      const modelIs = async model => assert.match(await evaluate('document.querySelector("[data-action=model]").textContent'), new RegExp(model));
      const choose = async model => {
        await click(browser, '[data-action="model"]');
        await click(browser, `dialog [data-action="choose-model"][data-value="${model}"]`);
        await modelIs(model);
      };
      await fresh(entry + '#bots'); await control('bot-chat'); await choose('GPT · thorough');
      await control('context-switcher'); await control('context-harbor');
      await modelIs('Sonnet · balanced');
      await choose('Local · quick');
      await palette('bots'); await control('bot-chat'); await modelIs('Sonnet · balanced');
      await control('context-switcher'); await control('context-atlas'); await modelIs('Sonnet · balanced');
      await palette('bots'); await control('bot-chat'); await modelIs('GPT · thorough');
      await palette('settings'); await modelIs('GPT · thorough');
      await click(browser, '[data-action="model"]');
      assert.equal(await evaluate('document.querySelector(\'dialog [data-value="GPT · thorough"]\').getAttribute("aria-pressed")'), 'true', 'picker marks the session selection');
      await key('Escape');
      await palette('profiles'); await control('profile-research');
      await palette('chat'); await modelIs('Sonnet · balanced');
      await choose('GPT · thorough');
      await control('context-switcher'); await control('context-harbor'); await modelIs('Local · quick');
      await palette('home'); await control('resume'); await modelIs('Local · quick');
    });
    await run(`${variant.id}/bot-fixture-ownership-matches-canonical-chat`, async () => {
      await fresh(entry + '#home');
      for (const [gateway, profile, target] of [['Harbor', 'research', 'context-harbor'], ['Atlas', 'studio', 'context-atlas']]) {
        await control('context-switcher'); await control(target); await palette('bots');
        assert.match(await evaluate('document.querySelector(\'main a[href="#bot"]\').textContent'), new RegExp(profile + ' profile'));
        await click(browser, 'main a[href="#bot"]');
        assert.match(await evaluate('document.querySelector(".detail-title .eyebrow").textContent'), new RegExp('Bot profile / ' + profile));
        assert.match(await evaluate('document.querySelector(".scope").textContent'), new RegExp('Gateway.*' + gateway + '.*Profile.*' + profile, 's'));
        const canonical = await evaluate('[...document.querySelectorAll(".kv")].find(e => e.querySelector("dt").textContent === "Canonical thread").querySelector("dd").textContent');
        assert.equal(canonical, gateway + ' / ' + profile + ' / mira');
        await control('bot-chat'); await routeIs('chat');
        assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Mira');
        assert.match(await evaluate('document.querySelector("main .meta").textContent'), new RegExp(gateway + ' / ' + profile + ' / mira'));
        await control('composer'); await browser.command('Input.insertText', { text: gateway + ' Mira draft' });
      }
      await control('context-switcher'); await control('context-harbor');
      await palette('bots'); await control('bot-chat');
      assert.equal(await inputValue(), 'Harbor Mira draft', 'roster routes into its own persistent mocked conversation');
    });
    await run(`${variant.id}/bots-chat-back`, async () => {
      await fresh(entry + '#bots'); await control('bot-chat'); await routeIs('chat');
      await control('back'); await routeIs('bots');
    });
    await run(`${variant.id}/context-failure-focus-return-and-draft-isolation`, async () => {
      await fresh(entry + '#chat'); await control('composer');
      await browser.command('Input.insertText', { text: 'Atlas draft\nKeep in studio.' });
      await control('context-switcher'); await control('context-failed');
      assert.match(await evaluate('document.querySelector("dialog").innerText'), /Atlas.*studio.*remains active/s);
      await key('Escape');
      assert.equal(await evaluate('document.activeElement.dataset.qa'), 'context-switcher');
      assert.equal(await inputValue(), 'Atlas draft\nKeep in studio.');
      await control('context-switcher'); await control('context-harbor');
      assert.match(await evaluate('document.querySelector("[data-qa=context-switcher]").textContent'), /Harbor.*research/s);
      assert.equal(await inputValue(), '', 'other context starts with its own draft');
      await control('composer'); await browser.command('Input.insertText', { text: 'Harbor draft' });
      await control('context-switcher'); await control('context-atlas');
      assert.equal(await inputValue(), 'Atlas draft\nKeep in studio.');
      await control('context-switcher'); await control('context-harbor');
      assert.equal(await inputValue(), 'Harbor draft');
    });
    for (const decision of ['approve', 'deny']) {
      await run(`${variant.id}/two-step-${decision}`, async () => {
        await fresh(entry + '#approval'); await control(decision);
        const dialog = await evaluate('document.querySelector("dialog[open]").innerText');
        assert.match(dialog, /Gateway.*Atlas/s); assert.match(dialog, /Profile.*studio/s);
        assert.match(dialog, /no execution|no shell/i);
        assert.match(await evaluate('document.querySelector("[data-qa=approval-result]").innerText'), /Awaiting/);
        await control(decision === 'approve' ? 'confirm-approval' : 'confirm-denial');
        assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false);
        const outcome = await evaluate('document.querySelector("[data-qa=approval-result]").innerText');
        assert.match(outcome, decision === 'approve' ? /Approved/ : /Denied/);
        assert.match(outcome, /No command was executed/);
        assert.equal(await evaluate('!!document.querySelector("[data-qa=approve]")'), false);
      });
    }
    await run(`${variant.id}/offline-blocks-send-and-approval`, async () => {
      await fresh(entry + '#chat'); await control('composer');
      await browser.command('Input.insertText', { text: 'Do not send' });
      assert.equal(await evaluate('document.querySelector("[data-qa=send]").disabled'), false);
      await mode('offline');
      assert.equal(await evaluate('document.querySelector("[data-qa=send]").disabled'), true);
      assert.equal(await inputValue(), 'Do not send');
      await control('command-palette');
      // A background transcript can contain the same link: scope to the modal.
      await click(browser, 'dialog a[href="#approval"]'); await routeIs('approval');
      assert.equal(await evaluate('document.querySelector("[data-qa=approve]").disabled'), true);
      assert.equal(await evaluate('document.querySelector("[data-qa=deny]").disabled'), true);
    });
    await run(`${variant.id}/sheet-focus-trap-and-escape`, async () => {
      await fresh(entry + '#home'); await control('context-switcher');
      for (let i = 0; i < 12; i++) {
        await key('Tab');
        assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true);
      }
      await key('Tab', 8);
      assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true);
      await key('Escape');
      assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false);
      assert.equal(await evaluate('document.activeElement.dataset.qa'), 'context-switcher');
    });
    await browser.viewport(360, 844);
    await fresh(entry + '#home');
    for (const route of manifest.routes) {
      await run(`${variant.id}/palette-pointer/${route.id}/360`, async () => {
        await control('command-palette'); await click(browser, `dialog a[href="#${route.id}"]`);
        await routeIs(route.id);
        assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false, 'including current-route selection');
        assert.equal(await evaluate('document.documentElement.scrollWidth - innerWidth'), 0);
        report.palettePointerRoutes++;
      });
    }
    await run(`${variant.id}/local-management-controls`, async () => {
      await fresh(entry + '#schedule'); await click(browser, '[data-action="toggle-schedule"]');
      assert.match(await evaluate('document.querySelector("main").innerText'), /Paused/);
      await browser.open(entry + '#capabilities'); await click(browser, '[data-action="toggle-capability"]');
      assert.match(await evaluate('document.querySelector("[data-action=toggle-capability]").textContent'), /Disabled/);
      await browser.open(entry + '#kanban'); await click(browser, '[data-action="complete-task"]');
      assert.match(await evaluate('document.querySelector("main").innerText'), /Moved locally/);
      await browser.open(entry + '#memory'); await click(browser, '#memory-note');
      await browser.command('Input.insertText', { text: 'Edited locally. ' });
      await click(browser, '[data-action="save-memory"]');
      await browser.open(entry + '#profiles'); await browser.open(entry + '#memory');
      assert.match(await evaluate('document.querySelector("#memory-note").value'), /Edited locally/);
    });
    await run(`${variant.id}/four-preview-states`, async () => {
      await fresh(entry + '#chats');
      for (const value of ['offline', 'empty', 'error', 'connected']) {
        await mode(value);
        const context = await evaluate('document.querySelector("[data-qa=context-switcher]").textContent');
        assert.match(context, new RegExp(value === 'connected' ? 'sample connected' : value));
        if (value === 'empty') assert.match(await evaluate('document.querySelector("main").innerText'), /No conversations yet/);
      }
    });
  }
  const hub = pathToFileURL(path.join(options.root, 'design/parity-compare/index.html')).href;
  for (const [width, height] of [[320, 844], [390, 844], [430, 844], [844, 390], [1440, 1000]]) {
    await run(`compare/switches/${width}x${height}`, async () => {
      await browser.viewport(width, height); await fresh(hub);
      await click(browser, '[data-view="workspace"]');
      assert.equal(await evaluate('document.querySelector("#workspace").checkVisibility()'), true);
      await click(browser, '[data-view="shell"]');
      assert.equal(await evaluate('document.querySelector("#shell").checkVisibility()'), true);
      if (width > 760) {
        await click(browser, '[data-view="both"]');
        assert.equal(await evaluate('[...document.querySelectorAll("main section")].every(e => e.checkVisibility())'), true);
      }
      assert.equal(await evaluate('document.documentElement.scrollWidth - innerWidth'), 0);
    });
  }
} catch (error) {
  report.checks.push({ scope: 'runner', status: 'failed', detail: error.stack });
} finally {
  report.diagnostics = browser.diagnostics;
  try { report.cleanup = await browser.close(); }
  catch (error) { report.checks.push({ scope: 'cleanup', status: 'failed', detail: error.message }); }
}
report.checks.push({ scope: 'no-browser-errors-or-outbound-attempts', status: report.diagnostics.length ? 'failed' : 'passed' });
report.summary = { checks: report.checks.length, failed: report.checks.filter(c => c.status === 'failed').length, routeCases: report.routeCases, palettePointerRoutes: report.palettePointerRoutes };
report.status = report.summary.failed ? 'failed' : 'passed';
if (options.output) await writeFile(path.join(options.output, 'extended-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, summary: report.summary, failures: report.checks.filter(c => c.status === 'failed'), diagnostics: report.diagnostics, cleanup: report.cleanup }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
