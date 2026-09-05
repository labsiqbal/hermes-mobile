# Local prototype QA (HM-UX-03)

`app/scripts/check-prototype.mjs` is a standalone Node ESM runner using only Node built-ins and an existing Chrome executable. It talks CDP over **Chrome's inherited fd3/fd4 pipes**, never a TCP debugging port. It opens local HTML through `file://`; it does not install packages, start a server, call a gateway, or modify the application/build output.

## Run

Node 22 and `/usr/bin/google-chrome` are the tested environment. Keep Chrome's sandbox enabled; do not run as root or add `--no-sandbox` to work around an unsuitable host.

```bash
# Run from the QA worktree. All evidence stays here, even when inputs are elsewhere.
node app/scripts/check-prototype.mjs \
  --root /home/iqbal/workspace/.worktrees/hermes-mobile/mobile-prototype \
  --output /home/iqbal/workspace/.worktrees/hermes-mobile/prototype-checks/.scratch/prototype-qa/prototypes

# Exercise the harness even before Studio's HTML exists.
node app/scripts/check-prototype.mjs \
  --self-test \
  --root /home/iqbal/workspace/.worktrees/hermes-mobile/prototype-checks \
  --output /home/iqbal/workspace/.worktrees/hermes-mobile/prototype-checks/.scratch/prototype-qa/self-test
```

`--root` and `--output` are required absolute paths. `--chrome /absolute/path/to/chrome` selects another existing executable. `--selectors /absolute/path/to/selectors.json` optionally aligns DOM selectors. `--help` documents the CLI. Choose a fresh evidence directory per run: filenames are deterministic and a rerun overwrites matching reports/screenshots. Old unrelated evidence is not deleted.

Exit **0** means all checks in that mode passed; exit **1** means a failed check, missing artifact, missing journey control, invalid manifest, or runner failure. A successful self-test is **not** successful prototype QA. There is no skip-failures or ignore-small-links flag.

## Input contract

The runner reads `design/parity-routes.json`, falling back to `parity-routes.json`. Example shape (not a complete manifest):

```json
{
  "schema_version": 1,
  "routes": [{ "id": "home", "title": "Home", "kind": "root" }],
  "variants": [
    { "id": "shell", "entry": "design/parity-shell/index.html", "root": "home" },
    { "id": "workspace", "entry": "design/parity-workspace/index.html", "root": "home" }
  ]
}
```

IDs must be unique literal lowercase hash slugs. The runner requires both variants and the agreed routes: home, chats, chat, bots, bot, groups, group, activity, approval, schedules, schedule, manage, gateways, profiles, capabilities, memory, messaging, webhooks, kanban, command-center, files, preview, artifacts, git, terminal, browser, settings, voice, native. Additional manifest routes are tested too. Each entry must exist under the input repository; the comparison hub is `design/parity-compare/index.html`.

Pages must render through actual `#route` changes. The runner does not fake a page's state by invoking `__prototype.navigate` or modifying `__prototype.getState()` results. It checks the visible DOM, not a claimed internal route alone.

When opening an entry URL without a fragment, the runner permits the page to initialize a default fragment (for example, the comparison hub's `#shell`), while requiring the exact requested document path and query. An explicitly requested fragment, including an empty `#`, requires exact URL identity; a redirect to another deep link, path, or query does not pass.

## Automated coverage

| Surface | CSS viewport | Coverage |
| --- | --- | --- |
| Both variants | 390 × 844 | Every manifest route; all five journeys |
| Both variants | 360 × 844 and 430 × 844 | Home, chat, manage |
| Both variants | 320 × 844 | Every manifest route, including overflow smoke |
| Comparison hub | 1440 × 1000 | Loaded content, links to both variants, targets, overflow, screenshot |

The current 29-route contract produces 128 route/viewport cases plus the hub. Journey checks are recorded separately. All viewport and target measurements are CSS pixels; screenshot device scale is 1.

Every route records:

- The loaded URL/hash, ready state, correct CSS viewport, nonblank main content, and rendered headings.
- Main-content changes between routes; identical fallbacks are failures, not coverage.
- An obvious sample/mock/prototype label.
- Page-level horizontal overflow, every rendered out-of-bounds element, and intentionally horizontally scrolling containers.
- Every visible actionable target's size findings, including **small text links** and rendered controls below the fold. Controls hidden by layout, hidden ancestors, visibility, or opacity are excluded. Disabled but visible controls still count for size. A target below 44 CSS px in either dimension fails, with only 0.01 px rounding tolerance.
- Basic discoverable-name findings. This is not a full accessible-name algorithm or accessibility audit.
- Shell bottom navigation on Home versus no bottom navigation anywhere in Workspace.
- An explicit visible native/desktop/bridge blocker explanation on the native route.
- Uncaught JS exceptions, `console.error`, browser error-level logs, failed loads, outbound request/WebSocket attempts, and interception failures.

A deliberately scrollable table/code panel is recorded, not automatically treated as global overflow. The **document's** scroll width must fit its client width within 1 px. Out-of-bounds element details remain in the report for human review; this also exposes clipping that a document-width test alone cannot diagnose.

Screenshots are taken for home/chat/manage in each variant at 390 × 844, plus the comparison hub. Capture continues despite ordinary assertion failures. A fatal browser or missing-entry failure can prevent later captures; the report remains failed and states why.

## Click journeys and selector alignment

The five journeys run at 390 × 844 for each variant. Clicks use CDP pointer events with visibility, disabled-state and hit-target checks; text entry uses CDP input. Native state selects are changed using their public `input`/`change` event path. No gateway action or internal application-state mutation is used.

1. **Chat draft → files → preview → Back → Back**: type an unsent draft, set transcript scroll, navigate using visible controls, verify return to files then chat, exact draft retention, and scroll restoration. A non-scrollable sample transcript is reported as a nonzero-scroll coverage limitation.
2. **Bots → chat → Back**: the bot's canonical chat entry returns to Bots, not Chats/Home.
3. **Approval**: scope labels identify gateway and profile; click Approve. If it opens a confirmation dialog, verify scope remains present and click a separate explicit confirmation control. A two-stage nonmodal confirmation control is also supported. Verify a visible approved/resolved outcome and changed content. Missing confirmation is a failure, not a reason to bypass the dialog.
4. **Offline disables send**: enter a draft, prove Send was enabled first, use the prototype's offline toggle or native state select, then verify Send is disabled and offline/disconnected state is visible. This is a UI state test, not a real network outage or delivery test.
5. **Modal Escape/focus**: open the context modal from Home, verify initial focus inside, forward Tab wrapping and reverse Tab containment, Escape dismissal, and focus restoration to the opener.

Default selector names below are the integration seam, not proof that Studio's DOM already implements them. CSS selectors can be overridden without weakening assertions. Do not alter a prototype to make a dangerous action immediate just to satisfy the test.

| Selector key | Preferred markup / meaning |
| --- | --- |
| `main` | `main` or `[role="main"]`; `#content` and `#app` fallbacks |
| `bottomNav` | `[data-bottom-nav]`; `.bottom-nav`, `.tabbar`, `nav[aria-label="Primary"]` fallbacks |
| `nativeWarning` | `[data-native-warning]`, `.native-warning`, or `[role="alert"]`; native main text is the fallback |
| `composer` | `[data-qa="composer"]`; `textarea` fallback |
| `transcript` | `[data-qa="transcript"]`; `.transcript`/`.messages` fallbacks |
| `files` | `[data-qa="open-files"]`; `[data-route="files"]`/`a[href="#files"]` fallbacks |
| `preview` | `[data-qa="open-preview"]`; corresponding route/link fallbacks |
| `back` | `[data-qa="back"]`; `[data-action="back"]`/`button[aria-label="Back"]` fallbacks |
| `botChat` | `[data-qa="bot-chat"]`, on the visible Bots-to-chat control |
| `approve` | `[data-qa="approve"]` |
| `approvalConfirm` | `[data-qa="confirm-approval"]` or `[data-qa="approval-confirm"]`; required explicit second step; missing control fails |
| `approvalResult` | `[data-qa="approval-result"]`; `[role="status"]` fallback |
| `offlineToggle` | `[data-qa="offline-toggle"]` or `[data-qa="state-select"]`; native select needs an offline/disconnected value or label |
| `send` | `[data-qa="send"]`; submit button / `button[aria-label="Send"]` fallbacks |
| `modalTrigger` | `[data-qa="context-switcher"]` |
| `dialog` | `dialog[open]` or `[role="dialog"][aria-modal="true"]` |

Override example:

```json
{
  "common": {
    "back": "#back-button",
    "offlineToggle": "#sample-state",
    "approvalConfirm": "#confirm-decision"
  },
  "shell": { "bottomNav": "#shell-tabs" },
  "workspace": { "modalTrigger": "#workspace-context" }
}
```

Use visible, unique targets. A missing selector or a different actual journey is a **failed** flow requiring alignment, never a silently skipped pass. If the UI legitimately adds a bot detail step, a file intermediate screen, or a context confirmation step, update the journey to follow those real controls and retain its final assertions.

## Evidence and self-test

Normal runs write `report.json`, `report.md`, and the available PNGs under `--output`. JSON contains every assertion and finding without truncation, browser version, diagnostic events, start/end timestamps, and cleanup outcome. The Markdown receipt lists every failed gate and screenshot. Chrome stderr is retained separately from page JS errors; host/browser-service stderr is not mislabeled as a page exception.

`--self-test` creates and removes temporary local fixtures and browser profiles inside the evidence directory. It proves the CDP handshake, evaluation, navigation, PNG signature/dimensions, timeouts and post-timeout reuse, protocol error rejection, exception recording, outbound interception, small-link/hidden-control behavior, process exit, and profile/fixture cleanup. It also exercises default-fragment initialization on hashless entries, preserves explicit deep links, and requires wrong explicit/empty fragments and changed document paths/queries to fail (including redirects while the page settles). A second synthetic fixture executes the complete route/viewport/screenshot runner. Its four missing journeys and immediate-approval-without-confirmation journey per variant **must fail**; the self-test checks that failures remain visible and all seven screenshots were still captured. Duplicate/malformed manifest IDs must also be rejected.

The synthetic report is explicitly labeled `synthetic-harness-fixture-not-prototype-evidence` and saved under `self-test/fixture-integration/fixture-report.json` for the example command. Do not copy synthetic screenshots into a prototype QA receipt or treat its expected failures as product defects.

## Bounded runner correction receipt

Against `/home/iqbal/workspace/.worktrees/hermes-mobile/parity-review`:

- Regression-first self-test failed on the default-fragment fixture before the fix: `/tmp/hermes-mobile-parity-correction-red/self-test.json`.
- Corrected self-test passed: `/tmp/hermes-mobile-parity-corrected-selftest/self-test.json`. Its synthetic integration report retained exactly ten expected missing-journey failures and captured all seven screenshots; this is harness evidence only.
- Real command: `node app/scripts/check-prototype.mjs --root /home/iqbal/workspace/.worktrees/hermes-mobile/parity-review --output /tmp/hermes-mobile-parity-corrected-qa`.
- Real result: **129 cases, 1,246 checks, zero failures, seven screenshots**, including the hub at its initialized `#shell`. All ten click journeys passed; browser diagnostics were empty. Evidence: `/tmp/hermes-mobile-parity-corrected-qa/report.json` and `report.md`.
- Both corrected runs exited 0 and confirmed owned Chrome exit and disposable-profile removal. No design edits, installations, servers, or debugging TCP ports were required. These `/tmp` receipts are local, temporary evidence, not portable publication or device signoff.

## Harness reuse and bounded cleanup

```js
import { ChromePipe, click } from './app/scripts/check-prototype.mjs';
import { pathToFileURL } from 'node:url';

const browser = new ChromePipe({
  chrome: '/usr/bin/google-chrome',
  output: '/absolute/existing/evidence',
  timeout: 8000,
  deadline: 240000,
});
try {
  await browser.start();
  await browser.open(pathToFileURL('/absolute/local/index.html').href);
  await click(browser, '[data-qa="open-files"]');
  console.log(await browser.evaluate('document.querySelector("h1").innerText'));
} finally {
  await browser.close(); // Required even when start() fails; idempotent.
}
```

Each CDP call/condition has an 8-second default timeout, and each browser lifetime has a 240-second watchdog. Cleanup rejects pending calls, sends SIGTERM to the owned detached Chrome process group, then SIGKILL after a bounded grace period, waits for exit, closes pipes and removes its disposable profile with bounded filesystem retries. SIGINT/SIGTERM trigger the same cleanup. An exit hook kills the owned group if Node exits unexpectedly. A cleanup failure is reported, not hidden. No users' existing Chrome sessions are targeted.

As with any user-space runner, SIGKILL of Node, host shutdown, or an unresponsive kernel can prevent profile deletion; no program can guarantee post-SIGKILL filesystem cleanup. Do not interpret the normal cleanup guarantee as an OS crash guarantee.

Page HTTP(S) requests are intercepted and failed **before continuation**. Chrome background networking is disabled, proxy use is disabled, and DNS resolution is blocked as defense in depth. WebSocket attempts are reported. This is page-level observation, **not an OS egress sandbox**: popups, workers, browser subsystems and deliberately hostile HTML are outside its guarantee. Use only the approved pure-inline local prototypes, never arbitrary untrusted websites. No debugging TCP port is opened.

## Remaining signoff

This runner does not prove WCAG contrast, complete accessible names, screen-reader semantics, reduced motion, text scaling, real mobile keyboards, landscape behavior, physical-device performance, iOS Safari, Android background/reconnect, or Owner task discoverability. Review screenshots and run the real-device/manual gates from the UX plan. Existing bot/resume checks belong to the parent integration receipt and remain separate from prototype rendering. No full Desktop parity, publication, app migration, or runtime approval follows from passing this script.
