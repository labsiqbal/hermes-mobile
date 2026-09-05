# Production Shell A browser regression harness

## Boundary and release gate

`app/scripts/check-production-browser.mjs` loads **the built React application in `--app-dir/dist`**. It does not load the Shell A prototype, rewrite React state, import a replacement App, or build a lookalike page. The unchanged production `HermesConnection` runs its authentication fallback, WebSocket handshake, JSON-RPC dispatch and history fetches against explicitly fictional transport fixtures injected before the bundle starts.

Basis: canonical `backlog.md` HM-PROD-01 and integration `docs/production/shell-a-spec.md` PA-01–PA-13. The agreed test seams are browser DOM/native history and gateway fetch/WebSocket boundaries. This harness is one release gate, not a replacement for TypeScript/build/lint, pure client/resume/security tests, independent source/visual review, or publication readback.

**Fixture/browser evidence is not authenticated live-gateway proof or complete official Desktop parity.** Physical iOS/Android keyboard, suspension/reconnect, assistive technology, external/native adapters and actual remote writes remain unverified. The browser fixture uses one gateway and two profiles; exhaustive multi-gateway/device concurrency is not certified.

## Run

Build the candidate separately. This command never installs dependencies, runs a dev server, rebuilds or changes the candidate:

```bash
node app/scripts/check-production-browser.mjs \
  --app-dir /absolute/path/to/candidate/app \
  --output /tmp/hermes-production-browser

node app/scripts/check-production-browser.mjs --self-test \
  --app-dir /absolute/path/to/candidate/app \
  --output /tmp/hermes-production-browser-self-test
```

Defaults: app directory above the runner; `./production-browser-evidence` output; `/usr/bin/google-chrome`. Override the Chrome binary with `--chrome /absolute/path/to/chrome`. Node 22 and an already installed Chrome are sufficient; there are no npm/browser automation dependencies.

Each normal run writes `report.json`, `report.md`, screenshots and layout measurements. JSON contains built-file SHA-256 hashes, Chrome version, individually named journey results, failure DOM/controls, intercepted fictional wire trace, unexpected network/console diagnostics and cleanup receipt. Any missing/failed journey, wrong roots, unexpected transport/error, or cleanup failure yields exit 1. Missing dist/invalid arguments also exit nonzero. Reports must be outside the candidate's dist.

A RED report is diagnostic evidence, never release approval. The runner continues independent checks after a failure, recovering only through actual Back controls. Dependent failures remain visible. Layout checks collect each requested viewport instead of stopping after the first bad width.

## Safety and implementation

Owned files:

- `app/scripts/check-production-browser.mjs`: production static server, CDP policy, DOM/native-input journeys, strict receipt validator, negative canaries.
- `app/scripts/production-browser-chrome-pipe.mjs`: focused copy of the reviewed prototype runner's exported `ChromePipe` class. No prototype runner import or side effects; includes only its transport/cleanup. The intentional change is a DNS exclusion for `127.0.0.1` so the temporary HTTP app origin is reachable. Everything else still resolves to `~NOTFOUND`.
- `app/scripts/production-browser-fixtures.mjs`: explicit invented fixture data and transport implementation.
- This document.

The ephemeral HTTP server binds **only `127.0.0.1`**, serves an in-memory snapshot of the selected dist, accepts GET/HEAD only and closes in `finally` on success/failure. Chrome runs in a newly created disposable profile, with background networking disabled and **CDP over `--remote-debugging-pipe`**, never TCP debugging. The owned browser process group is terminated and its profile removed, including on interruption/deadline. No gateway credentials are read from the user's profile or environment.

Only `gateway.production-qa.invalid` and invented `fixture-user` / `NOT-A-REAL-PASSWORD` are seeded into the disposable browser's localStorage. All fetch calls are intercepted; there is no passthrough, including for same-origin `/v1` APIs. The WebSocket stand-in exchanges the actual client's newline-delimited JSON-RPC protocol. Unknown fetch routes, RPCs, profile/path contexts and mutations without an explicit harness permit fail closed and poison the report. A second CDP request interceptor allows only exact built asset paths on the owned loopback origin; unknown images, XHRs and other requests are blocked and fail the gate. Beacon and EventSource transports are prohibited. No prompts, session creation, steering or interrupts are issued.

Fixtures do not supply UI state functions. `window.__productionFixture` controls only transport data, held requests, explicit errors, empty/unsupported results, offline socket transitions and approved fictional writes. `window.__qaDOM` contains read-only DOM lookup helpers. Tests use native CDP touch/keyboard input, native history entries and public DOM scrolling/focus, not internal stores or React setters.

## Fixed journeys and coverage

| Journey | Observable gate | Acceptance |
|---|---|---|
| login-connect | Saved fictional device opens; ticket 401 → basic password login → ticket → gateway.ready; live client fetches sessions | PA-02/03 |
| root-navigation | Exactly Home, Chats, Bots, Activity, Manage in order; real controls activate the named destination | PA-01/02 |
| project-resume | Project expansion calls `projects.project_sessions`; existing session resumes through RPC and REST transcript | PA-02/03 |
| workspace-history-draft | Long transcript scroll and unsent draft survive Files/Git/Terminal and preview trust review/cancel plus native Back/Forward; explicit gateway/profile/session context; no credential/draft objects in History | PA-04/05/06/08/11 |
| bot-profile-draft | Canonical Bot Chat reuses its ID/profile; REST carries profile; project/bot drafts and selected models remain isolated, including browser history | PA-02/03/04 |
| groups | Groups entered through Chats; shared registry room opens with restored log; long-press deletion shows confirmation, cancel does not write | PA-02/09 |
| activity-runs | Existing tracked-run fallback and SSE details remain reachable under Activity | PA-02 |
| manage-sections | Devices, Profiles, Capabilities (Skills/Toolsets/MCP), successful default-profile Memory/Schedules/Messaging reads, blocked noncurrent Memory/Messaging, post-read ownership changes and cron owner-echo rejection, Webhooks boundary, Kanban, Appearance/native boundaries, Workspace and Bots routes; profile-description review/cancel/confirmed write/readback; loading/empty/error/unsupported resource states | PA-07/08/09 |
| chat-controls-approval | Attachment menu and model search; real client streamed events update transcript/stop state; approval cannot auto-respond and explicit Deny targets the request | PA-03/09 |
| transport-states | Held roster response shows loading; explicit error, unsupported, empty and offline states; reconnect restores roster | PA-07 |
| responsive | Five roots plus chat/workspace at 360×844, 390×844, 430×844 and 844×390; no document horizontal overflow; enabled visible controls have names and ≥44px targets | PA-10 |
| palette-focus | If a command palette control exists, Ctrl+K opens it, Tab stays in dialog, Escape closes and restores trigger focus | PA-10 |
| transport-audit | Zero unexpected console/browser errors, real outbound requests, unknown fixture calls or unauthorized fixture mutations; no prompt/execution calls | PA-11/12 |

The fixed family list is based on the implementation's public labels, not generated from whatever controls happen to exist. Missing sections do not become skipped checks. The only optional surface is the explicitly conditional command palette; its absence is recorded.

Self-tests reject legacy/wrong/missing roots, every omitted mandatory journey, console errors, unconfirmed fixture mutations and profile leaks. Actual Chrome canaries modify a tiny **in-memory self-test page** to demonstrate wrong-root rejection, emit an expected console error and attempt a blocked `.invalid` fetch. They also exercise injected auth/file and final management contracts, reject guessed API schema/wrong profile/extra query, and demonstrate immediate mutation rejection. This canary page is never used as production-app evidence.

## Fixture contracts / integration expectations

Existing client reference: baseline `9b25ec8` `app/src/lib/hermes-client.ts`, `runs-client.ts`, `group-store.ts`, `ChatView.tsx` and Bots/Groups/Connections screens. The parent explicitly identified the production root `/openapi.json` 404; this fixture preserves that failure and never treats a guessed schema as proof of profile isolation. Additional read contracts were inspected in the concurrently implemented `management-client.ts`, `workspace-client.ts`, `Manage.tsx` and `Workspace.tsx`; reconcile only against their final sourced contracts, never add a generic “return success” fallback.

Explicit response families:

- `/api/status`, `/auth/password-login` (`provider: "basic"`), `/api/auth/ws-ticket`; fake WebSocket `gateway.ready` and JSON-RPC.
- `session.list`, `projects.tree`, `projects.project_sessions`, `session.resume`, `session.events.since`, `profiles.list`, `profiles.describe`, `approval.pending`, `model.options`; session history REST.
- `/v1/capabilities`, no-list 405 `/v1/runs`, `/v1/runs/qa-run` and its SSE events.
- Root `/openapi.json` explicitly returns 404, matching the production static/proxy serving contract; `/api/openapi.json` is unregistered and rejected. Final `management-client.ts:193–225,247–254` and `scripts/check-management.mjs:50–109,199–247` source the successful fictional reads: `/api/profiles/active` returns `{current:"default",active:"qa-bot"}`; Memory graph/node and Messaging require exact `?profile=default` and before/after `current` checks. Selecting `qa-bot` must send only the identity request, not content, even though sticky `active` matches. A changed post-read `current` must discard results. Graph nodes use `kind:"memory"`, `memorySource`, and positional `memory:memory:0`; detail echoes `ok`, `kind`, `id`, `content`. Cron returns an array with `profile` owner echo and `schedule_display`; mismatched ownership must not render. Messaging projection excludes fictional env values, home channel and diagnostic sentinels. No schema is required or fabricated. Capability RPCs supply loading/empty/error/unsupported browser cases. Explicit gateway-wide Kanban board selection remains separate.
- Workspace exact profile/path `/api/files`, `/api/files/read`, `/api/git/status`, `/api/git/file-diff`. Files contain invented plain text, not content from the developer machine. Final `production-workspace` `workspace-client.ts` and `Workspace.tsx` match the integrated candidate sources. Terminal remains unavailable; preview review/cancel checks the exact destination and cookie warning without opening it externally. The workspace eyebrow uses CSS uppercase, so the innerText assertion matches `CONVERSATION WORKSPACE`.
- Only deliberately permitted `config.set`, `approval.respond` and `profiles.configure` calls may change fixture memory. Review/cancel are checked before permit issuance; the source-backed profile-description write is read back through `profiles.describe`.

Preserve visible conversation vs hidden Workspace sibling semantics when adapting selectors. A hidden mounted textarea is not evidence that Back already returned to chat. Keep the native Back/Forward and contextual model/draft assertions; do not replace them with direct route writes. Do not suppress console errors or relax 44px gates to make the candidate green. A contract mismatch must be resolved using final source and a bounded correction, or remain a release blocker.

## Final correction receipt (fixture-only, ready for independent parent gate)

Frozen correction source: `shell-production` worktree. Final full built-App receipt:
`/tmp/hm-final-browser/report.json` and `report.md`; self-test receipt:
`/tmp/hm-final-browser/self-test.json`. Both pass. The full receipt includes 15 mandatory
journeys, all 28 root/detail layout audits, screenshots, exact built-asset hashes,
zero browser/outbound diagnostics, zero fixture violations, and verified browser,
disposable-profile and loopback-server cleanup. These supersede the historical RED
integration runs below; they are not publication or live-gateway proof.

- Restored new-session history: a completion retires `unpersisted`; newer resume
  message counts/history/cache terminal evidence override a stale fresh hint.
  An empty fresh resume still avoids the legitimate first-use REST 404.
- Draft identity: verified durable/resolved aliases share one gateway-ID/endpoint/
  profile-scoped in-memory view; the mounted creation seed remains stable.
- Manage remembers only page/profile per gateway ID+endpoint. Re-entry revalidates
  the profile roster and refetches content. Review tokens, write drafts and approvals
  are not cached; browser tests leave a review through native History and switch
  gateways to verify that no stale confirmation returns or writes.
- Workspace scroll failure was the initial 350ms Markdown measurement pin overriding
  a reader's scroll, not draft loss. The pin now yields to the reader. The isolated
  DOM probe and full journey restore 200px rather than the former 1388px.
- Palette Tab escaped to BODY at the final destination; explicit end wrapping keeps
  forward focus inside. The full native-keyboard journey passes and Escape restores
  trigger focus.
- Animated fixture clicks wait for finite target/ancestor animations and actual
  center-point hit readiness within the existing deadline. They still fail on an
  obscured/nonreachable target; no sleeps/timeouts, 44px rules or error guards were
  relaxed.

Additional executed receipts: `/tmp/hm-final-navigation/report.json` (shared new-chat
and Manage regression journeys), `/tmp/hm-chat-reveal-YHMxXX/report.json` (11 actual
ChatView/controlled-RAF checks), and 26 harness control/negative canaries in the
self-test receipt. Unit/transport checks, Manage browser checks at 360/390/430,
TypeScript/Vite build and 31 static-publisher unit tests pass. Lint exits zero with
8 existing warnings, including the prior ChatView reveal effect warning; this is
not a zero-warning claim. New npm scripts and CI steps run reveal/navigation checks;
the same navigation journeys remain mandatory in the full browser receipt.

No dependencies, live prompts/authentication, credentials, service/routes, serving
root, publication, commit or push were changed by this correction round. Parent
owns clean-install verification, independent visual review and release readback.

## Historical final-contract integration evidence

Earlier bounded run: `/tmp/hm-production-qa-final-contract-v3/report.json` (and `report.md`, screenshots in that directory), against `/home/iqbal/workspace/.worktrees/hermes-mobile/shell-production/app/dist`. **RED, not release approval.**

- Final management journey passes: fictional default-profile graph/detail, Messaging projection, before/after current-profile checks, blocked `qa-bot` content reads, changed post-read owner rejection, cron owner-echo rejection, existing description confirmation/readback and all required section boundaries.
- Login, exact roots, project resume, Groups, Activity, Manage and transport audit pass. The candidate was rebuilt externally between the first and second runs; latest project-resume now passes the unchanged long-history assertion. This QA lane did not build or edit the app.
- Workspace reaches actual Files read, Git diff, Terminal boundary, preview trust review/cancel and native Back; draft survives, but transcript scroll returns **1388 instead of 200**, reproduced in v2 and v3. The later bot model assertion is dependent: the prior scroll failure prevents the model-switch step, so this is not evidence of a separate model isolation defect.
- Approval interaction fails before dispatch: Deny rectangle starts at `y=873.898` in a `390×844` viewport while the sheet entrance animation is running at about `66.734ms`. This is an **interaction/animation timing blocker**, not proof of permanently clipped settled layout. Existing waits were deliberately not changed. The pending approval then obscures Back and blocks the later transport/responsive/palette journeys; those dependent failures are not independent app defects.
- Earlier `/tmp/hm-production-qa-final-contract/report.json` independently reached all 20 root/viewport layout checks (passed) and caught the command-palette Tab focus containment failure. That older candidate still failed settled-history replay. Latest palette coverage is blocked by the pending approval, so the earlier focus finding needs an isolated rerun after integration fixes.
- Latest report has zero unexpected browser/outbound diagnostics and zero fixture violations; Chrome exited, disposable profile was removed, and loopback server closed. No real external requests, gateway mutations, app-source writes or dist changes were performed.
- `/tmp/hm-production-qa-final-contract-self-test-v2/self-test.json`: **23** control/negative canaries pass, including final management scope/query/schema rejection. All three scripts pass Node syntax checks. `git diff --check` plus explicit `git diff --no-index --check /dev/null <owned file>` checks cover the untracked deliverables, including the helper EOF correction.

The JSON artifact hashes identify each in-memory dist snapshot; do not combine older and newer reports into a green receipt. Parent must copy the four owned artifacts, rebuild as needed, rerun the full gate, and independently inspect screenshots. No mandatory journey, no-outbound/mutation restriction, 44px assertion or history timeout was relaxed.

## Initial execution evidence (historical)

During QA authoring, the integrated Shell A dist was not yet available. The real existing canonical production dist was used as the permitted RED control:

- `/tmp/hm-production-qa-legacy-red/report.json`: actual built React app connected with fictional transport and passed project hydration/resume. It rejected legacy roots **Board / Chats / Groups / Bots / Runs / Settings** and missing contextual Workspace. Transport audit recorded no unexpected gateway/outbound traffic or fixture violations. Chrome exited, disposable profile was removed and server closed.
- `/tmp/hm-production-qa-self-test/self-test.json`: 22 negative/control canaries passed, including actual injected immediate-mutation rejection. This proves harness behavior, not the candidate's new journeys.
- `/tmp/hm-production-qa-legacy-red-final/report.json`: latest long-history run failed closed (exit 1); login and transport audit passed, with no diagnostics/fixture violations and verified cleanup. The long settled transcript did **not** render its final marker within the gate. The DOM showed progressive text through paragraph 16 rather than all 24. Inspected Shell A `ChatView.tsx` still builds settled history items without `instant: true` and its `useSmoothReveal` advances even with streaming false. This is a production resume regression to fix, not grounds to lengthen the assertion timeout. The final run captured 14 screenshots; subsequent failures include expected legacy navigation/context gaps.
- Node syntax checks and `git diff --check` were run on owned code. No app source, package manifest, lockfile or production dist was changed.

These local `/tmp` receipts are not publication artifacts or durable live parity claims. Integration must run the final harness against a fresh candidate build, preserve its new report/screenshots, review failures and independently inspect screenshots before PA-12 can pass. PA-13 source/served-asset readback belongs to the parent release gate and is not performed here.
