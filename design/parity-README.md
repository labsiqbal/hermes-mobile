# Hermes Mobile — replacement navigation studies

**Local design prototypes, not runtime parity.** Current app and existing V2/V3/V4 designs are untouched. Both candidates run self-contained via `file://`; no build, install, service, CDN, font download, credentials or gateway is needed.

## Open

Start with [the comparison hub](parity-compare/index.html). Standalone: [A — evolved shell](parity-shell/index.html) and [B — workspace first](parity-workspace/index.html).

URL compatibility: local `file://` entries retain `index.html`. On HTTP(S), open the directory URL ending in `/` (for example, `…/parity-compare/`); the hub assigns directory URLs to both standalone links and both iframes. Frames have no initial `src`, avoiding an early request to the host’s incorrectly redirected `index.html` path. Destinations come only from the two inline constants, never query/hash input. This does not repair server redirects before the hub loads. Offline regression: `node app/scripts/check-prototype-entry-paths.mjs` — six URL cases passed, including query/hash isolation and rejected unknown entries; no live network or service changes.

- A: Home device cards and one-tap resume; exactly five root tabs Home / Chats / Bots / Activity / Manage. Detail pages, including chat, use Back instead of tabs. Files/Git are contextual chat tools.
- B: Devices (`#gateways`) → Workspace (`#home`) → Conversations / Activity / Collaborators / Manage → detail. Root is a resumable project workspace with a separate workbench. No persistent bottom navigation anywhere. Devices remains a visible escape from Workspace.
- Same fictitious Atlas/Harbor gateways, studio/research profiles, Field notes project, Launch brief conversation, Mira/Cedar roster and Morning brief schedule. Mira is a separate fictional fixture in each available gateway/profile namespace; roster ownership, canonical thread and mocked chat all use that fixture identity. No cross-profile backend routing is implemented. Secondary sample entries intentionally resolve to their family’s representative detail, not an invented unique backend record.
- The [route manifest](parity-routes.json) contains 29 shared routes. Every `#route` can be opened directly and found through the command palette. Both candidates maintain hash/history navigation and expose `window.__prototype.navigate(route)` / `getState()` for diagnostics. Test interactions through visible controls, not that hook.

## Working local journeys

Resume; multiline composer (Enter sends a simulated message, Shift+Enter inserts a newline); files → preview → Back and Git → Back preserve draft and transcript scroll; direct Bots → Mira chat → Back returns to Bots. Opening the bot detail first returns there first, as normal push history.

Context selection offers two successful fictitious targets and one failed target. Failure keeps the active gateway/profile and draft. History entries restore gateway/profile/conversation identity as well as the route; native Back/Forward preserves each conversation’s draft and scroll. Direct-entry Back replaces synthetic parents rather than pushing the child again. Session model choices are keyed by gateway/profile/conversation, defaulting to Sonnet · balanced without changing profile defaults. Drafts, transcript positions, simulated messages, approvals, schedules, capability toggles, memory notes and Kanban decisions are scoped in memory; no browser storage is used. Re-selecting a context restores its local draft. State preview does not contact a gateway; Offline / Error / Empty disable mutation controls. Sample-connected is never a real connectivity claim.

Approval requires a second explicit confirmation for both approve and deny. Scope is repeated in the confirmation; resolved requests cannot be re-approved. All outcomes say simulation; no shell executes. Reload to exercise the opposite outcome. Schedule pause/resume, capability toggles, memory-note save and Kanban completion only change local mock state.

Every header exposes context and a command palette. Dialogs use native modal semantics plus explicit Tab/Shift+Tab wrapping, Escape and focus return. Chat hides the large prototype banner; the transcript and compact state selector retain sample labels. Composer remains in layout, not behind a fixed banner.

## QA selector contract

Use `[data-qa="…"]` unless stated otherwise:

| Control | Selector / behavior |
| --- | --- |
| Resume | `resume` — home and conversation list |
| Composer / transcript / send | `composer`, `transcript`, `send` |
| Files / preview / Git | `open-files`, `open-preview`, `open-git` |
| Back | `back` (history-aware, parent fallback on direct hash entry) |
| Mira direct chat | `bot-chat` on Bots and bot detail |
| Context trigger | `context-switcher` |
| Sheet context choices | `context-atlas`, `context-harbor`, `context-failed` |
| Gateway screen choices | `gateway-atlas`, `gateway-harbor`, `gateway-failed` |
| Profile choices | `profile-studio`, `profile-research` |
| Approval decisions | `approve`, `deny` |
| Second-step decision | `confirm-approval`, `confirm-denial` inside `dialog[open]` |
| Outcome | `approval-result` |
| State preview | `state-select` — native select; values `connected`, `offline`, `empty`, `error`; dispatch `change` after choosing |
| Palette | `command-palette`; input `[data-action="palette-search"]` |
| Bottom navigation | `[data-bottom-nav]` — A root screens only; never B |
| Native blockers | `[data-native-warning]` on terminal, browser, voice, native |

Other controls expose `data-action`; route links use `href="#route"` (most also have `data-route`). Native select preview is directly available in the root banner and chat model row; in landscape it remains reachable inside the context picker.

## Known limitations / review gate

- Representative detail fixtures, not complete Desktop action semantics or a remote feature implementation. The independently audited parity matrix remains authoritative for backend feasibility.
- Files/diffs are hard-coded trusted text. No real file upload/download, Git mutation, terminal/PTY/SSH, browser annotation, microphone, messaging delivery, webhooks, MCP installation, profile import/export, keychain, HUD, OS shortcut, update/restart or background agent execution.
- Native pages name their Desktop capability families and explicitly mark blocked/not connected. These are not new transport claims or a source audit.
- In-memory state resets on reload and is independent between candidates. Browser navigation is supported within a candidate; history is not synchronized across iframes. Changing context changes the sample namespace; it is not a real reconnect.
- Appearance/language/provider/safety settings beyond the demonstrated interactions are explanatory read-only sections. No secret fields or authentication UI.
- Real iOS Safari/Android Chrome, virtual keyboard, assistive technology, 200% text scaling and device background/resume still require owner/device QA. Headless checks do not establish production accessibility or runtime parity.
- No publication, production migration, service change, commit or push performed by Studio. Manager owns later review/publication gates.

## Validation

Validated on the final Studio artifacts with installed Node 22 and Chrome, using the QA specialist’s `ChromePipe` (CDP over file descriptors; no port or package install):

- All three inline scripts parse with `vm.Script`; route manifest parses with all 29 required IDs.
- Persisted runner: `app/scripts/check-prototype-extended.mjs` — **324 checks passed, 0 failed**, covering **232 route/viewport cases**, **58 pointer-driven palette destinations**, core journeys, local management actions, four preview states and five compare-hub viewports. No browser errors or outbound attempts were recorded; temporary Chrome profile was removed and Chrome exited.
- Route sizing: all 29 routes in both candidates at 320×844, 390×844, 430×844 and 844×390. Palette reachability at 360×844. The route pass asserts no page horizontal overflow and 44px visible controls.
- Real pointer journeys (plus CDP native history traversal) verify restored conversation identity, context-scoped session model choices, consistent bot ownership/canonical chats, repeated direct-entry parent Back, and nonzero transcript-scroll restoration and multiline drafts through Files → Preview → Back and Git → Back; Bots → chat → Back; failed context switch; separate Atlas/Harbor drafts restored in both directions; modal forward/reverse focus and Escape return; both two-step approval outcomes; offline send/approval blocking.
- Hub switches exercised at 320×844, 390×844, 430×844, 844×390 and 1440×1000, including wide side-by-side mode.
- Final small corrections: current-route palette selection closes the dialog; hub initial load preserves its entry URL; programmatic heading focus has no decorative outline (interactive focus indicators retained); phone prototype banner uses its compact label.
- `git diff --check` passes. App runtime/source, package files, existing designs, services and gateways were not changed.

Run in the integrated review worktree, with the QA specialist’s `check-prototype.mjs` beside the extended runner:

```sh
node app/scripts/check-prototype-extended.mjs --root "$PWD" --output /absolute/evidence-directory
```

The extended runner imports the integrated sibling `./check-prototype.mjs` without a loader mapping. `--output` is optional (stdout summary only without it). Final bounded-review evidence is under `/tmp/hermes-mobile-review-corrected/`: `green-extended/extended-report.json`, `green-baseline/report.json` and `green-selftest/self-test.json`. Baseline: **129 cases, 1,246 checks, zero failures, seven screenshots**. Harness self-test passes and rejects immediate approval without a second confirmation (ten expected synthetic journey failures, not prototype defects).

URL-hotfix revalidation: `/tmp/hermes-mobile-entry-path-hotfix/baseline/report.json` passed all **1,246** checks. Extended sizing initially failed near `#profiles` at 844×390; browser warning capture proved Chromium navigation flood protection at the candidates’ `popstate` → `replaceState`, not a hub regression. Failure reports remain in `extended/`, `extended-rerun/` and `extended-diagnostic/` under that same temporary evidence root. The extended runner now starts a fresh document per sizing viewport and waits for the requested hash, rendered route state and main/heading before retaining every existing assertion. No candidate handler, browser protection or delay was changed. `extended-fixed/extended-report.json` passed **324/324**, including all **232** route/viewport cases and **58** pointer palette destinations; `extended-fixed/browser-warnings.json` is empty. These are offline checks, not published HTTP/device signoff.

Regression-first evidence: `red-extended/extended-report.json` records all eight expected UI failures against preserved prepatch HTML (four findings in each candidate). `red-selftest/fixture-integration/fixture-report.json` records both immediate-approval journeys incorrectly passing before the QA fix; the self-test correctly went RED (`8 !== 10`). These are local temporary receipts, not portable publication, visual approval or physical-device signoff.
