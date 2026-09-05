# Hermes Desktop Parity & Mobile UX Implementation Plan

> **For Hermes:** Use specialist task delegation with spec-compliance and code-quality review when implementation is approved. Load the available implementation/TDD skills; do not assume an unavailable skill exists.

**Goal:** Make all current official upstream Hermes Desktop built-in capabilities accessible from mobile through task-appropriate interactions, with explicit, Owner-reviewed handling of native-only capabilities.

**Architecture:** Preserve the existing React-free gateway client and tested session/resume behavior. Redesign the mobile presentation and navigation incrementally, extending verified upstream contracts through scoped adapters only where needed. Native/privileged gaps require feasibility proof and separate authority approval, not invented APIs or modifications to Hermes core.

**Tech Stack:** Existing React 19, TypeScript, Vite 8, Lucide, React Markdown; Python relay companion. No new dependency, service, native shell, or bridge has been selected.

**Status:** Owner approved “oke gas” for local replacement-candidate build: action inventory, two interactive prototypes, and deterministic QA. Current layout may be rethought; V2 is a reference, not a constraint. Production app migration, final navigation selection, publication and runtime mutations still require their own gates. Active tickets and bounded milestone contract: `backlog.md`.

---

## 1. Baselines and evidence

- Mobile inspected at `9b25ec8`, branch `main`, working tree clean before writing this plan.
- Official latest release API observed: `v2026.8.31`, named Hermes Agent v0.21.0, published 2026-08-31T19:29:49Z; release commit independently resolved to `29112bef099274229cadff79cdff7bf7b99c4b77`.
- Current upstream main snapshot observed: `9dd6634c5635321cf38840cc30e9b51226689128`.
- Treat the release and main as separate baselines. Inventory current built-ins at pinned main; explicitly mark post-release features and the minimum backend version/contract needed. Never let moving main silently enlarge an implementation milestone.
- Authoritative current docs: https://hermes-agent.nousresearch.com/docs/user-guide/desktop and https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop . Docs obtained through curl/urllib after web_extract failed with an address-classification block.
- Upstream release: https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.31 . Source: https://github.com/NousResearch/hermes-agent/tree/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop .
- Documentation contains some conflicting historical claims (for example connection scope and keychain defaults). Affected rows remain unresolved until source contract at the pinned SHA is traced. Do not reproduce prose as security guarantees.
- Existing code evidence: `app/src/App.tsx:57`, `app/src/components/TabBar.tsx:12`, `app/src/lib/hermes-client.ts:1187`, `app/src/lib/group-driver.ts:18`, `app/src/lib/group-store.ts:51`, `app/src/screens/Runs.tsx:1`, `app/src/screens/Settings.tsx:83`.
- Actual offline checks in this session: `npm run check:chat-resume` PASS; `npm run check:bots` PASS; `npm run lint` exit 0 with existing warnings; `git diff --check` exit 0. These are NOT browser, build, or live parity evidence.
- Workspace INDEX was inspected; this project is not registered there. No project AGENTS/MAP/CONTEXT were found. Registration/document cleanup is a separately scoped follow-up, not an unrequested edit during planning.

## 2. Product contract

1. Functional parity, not a shrunken Desktop window. Every Desktop action receives a mobile destination or an explicit blocked/native classification.
2. Gateway -> profile -> project/session is the execution context. Project may be absent; gateway/profile may not be ambiguous.
3. Sessions, approvals, skills, cron and server settings remain authoritative on their owning backend. Local draft/preferences/cache must not pretend to be server truth.
4. V2 Board/bottom-tab layout is the existing reference, not a limit on replacement candidates: Owner explicitly authorized rethinking navigation. Preserve readable chat, clear context, and English default UI. Compare changed interaction patterns explicitly, including any reintroduction of search, before app migration.
5. Full upstream language selection is still an inventory item. English-first design does not authorize dropping upstream localization/RTL from the parity goal.
6. No custom plugin feature scope. Official bundled features implemented using upstream's plugin mechanism ARE in scope (notably Bot Mode); plugin implementation does not make a shipped built-in optional to inventory.
7. The previously discussed ~50% readiness estimate described the existing product, not the new full Desktop parity scope. Do not reuse it as feature coverage.
8. Never imply a phone browser continues a client-owned group orchestrator while suspended. Background execution ownership must be proven per workflow.

## 3. Preliminary feature families (docs-verified, not an exhaustive action inventory)

| Family | Desktop capabilities to inventory | Mobile proposal / known gap |
|---|---|---|
| Chat and composer | streaming, tool summaries, history, attachments, composer history, queued prompt edit/pause/resume, stop, turn navigation, transcript find | Keep verified chat path; touch-friendly queue sheet, conversation outline and transcript find; no hover-only access |
| Session controls | model/reasoning/fast presets, sticky selection, context breakdown, cache/throughput, timers, YOLO/approval controls, workspace/status customization | Compact composer + session inspector; dangerous modes require explicit scope and confirmation; do not conflate session and profile defaults |
| Sessions/projects | project discovery policy, archive/hide/search, concurrent profiles, cross-profile session references, tabs/reopen | Project browser and resumable session switcher; typed route identity and scoped draft/scroll state |
| Multi-gateway | registry, primary/last-used behavior, local/remote/SSH/Cloud kinds, test, union roster, name collision rules | Device/profile picker; failed switch leaves prior context intact; SSH/Cloud/native support must be contract-proven |
| Bots and groups | all-profile roster, canonical chats, create/edit agents, capabilities, avatars, sections/pins/hide, routines, group lifecycle, mentions/delegation | Bot detail subpages and group conversations; current mobile group driver is gateway-local, not full upstream parity |
| Files/artifacts | workspace browser, preview/download/copy/open, artifact gallery and source-session jump | Full-screen workspace browser and preview with return to unchanged chat/draft |
| Browser/annotation | in-app browser, element/region comments, cropped screenshots, selector/markup/style context, redaction, explicit add-to-composer | Native/bridge feasibility gate; external link alone does not satisfy annotation parity; untrusted page isolation required |
| Terminal | persistent shells, multiple terminals, scrollback, add output to composer | Remote PTY feasibility and security gate; keyboard accessory row; hiding a panel is not closing a shell |
| Git/worktrees | diff scopes, stage/unstage, revert, branch/create/switch, commit/push/PR, worktree create/remove/hide | Workspace review pages; inspect-first, action-specific confirmations naming repo/branch and remote effect |
| Skills/tools/MCP | installed/optional catalog, toggles/install, toolsets/backend setup, scope selector, MCP setup/hot reload | Manage capability pages with exact applies-to scope; runtime installs/access changes separately gated |
| Profiles/memory | profile settings, SOUL, export/import, memory graph timeline/filter/layout share/edit/archive | Profile detail pages, graph/list accessible alternative; same operation semantics; redaction and import validation |
| Scheduling/orchestration | cron, bot routines, Agents/Command Center | Automation/Activity pages backed by actual upstream contracts; existing /v1/runs tracking is NOT a substitute for cron management |
| Messaging | setup/manage gateway channels | Scoped management pages; distinguish gateway lifecycle from serve process |
| Settings/onboarding | providers/accounts/keys, model defaults, local models, workspace/safety/memory/voice/chat/tools, appearance/themes/font, shortcuts/languages | Categorized settings, masked secrets, explicit profile scope; OS-local installers/theme imports need capability classification |
| Voice | microphone capture, transcription, voice playback | Permission/format/browser support tests; no silent recording; native constraints documented |
| Lifecycle/support | backend/client updates, multi-instance outcomes, diagnostics consent/redaction, logs, uninstall options | Remote lifecycle operations Owner-gated; client refresh distinct from backend restart/update; local OS removal cannot be faked in PWA |
| OS/window affordances | multiwindow/panes, Quick Entry global hotkey, HUD/always-on-top/screen context, keep-awake, keychain | Separate desktop affordances from user outcomes; phone equivalents require Owner acceptance or native/bridge decision. Blocked items stay in parity denominator |

### Required action-level matrix after this plan

Proposed artifact: `docs/parity/features.json`, with one stable ID per user action, not just per tab. Required fields:
`id`, `family`, `desktop_source_sha`, `desktop_source_path`, `desktop_symbol`, `docs_url`, `release_status`, `scope`, `desktop_transport`, `gateway_contract`, `mobile_route`, `current_status`, `target_status`, `authority`, `browser_constraints`, `acceptance_test_ids`, `evidence`, `blocker`.

Allowed current statuses: `unverified`, `missing`, `partial`, `implemented-unproven`, `verified`, `blocked`. Platform disposition is separate: `direct-web`, `mobile-equivalent-proposed`, `bridge-required`, `native-only`. An Owner-accepted equivalent must retain its original Desktop requirement and test evidence.

Validator proposal: `app/scripts/check-parity.mjs` rejects duplicate IDs, missing required fields/source pins, undocumented exclusions, verified rows without passing evidence, and unsupported route/test references. Coverage reports separate inventory completeness, verified functional parity, native blockers, and release readiness. Do not infer coverage from UI screenshots or hide blockers to inflate a percentage.

### Specialist cross-check and transport findings

Lab independently confirmed the upstream SHA and distinguished Desktop package version from Agent release version. Official bundled discovery includes Bot Mode, Kanban and Accent; default-off bundled features remain in inventory. Additional action families to enumerate explicitly: clarify/secret/sudo prompts; branch/rewind/compress; session export; webhooks; Kanban boards/tasks/events/import/export; Command Center logs/usage/maintenance; Browser settings; notifications/billing; pets and accent controls. This is still not an exhaustive action audit.

Parent independently checked pinned source:
- `apps/desktop/src/app/routes.ts:62-70` includes Command Center, webhooks and starmap, beyond the familiar sidebar tabs.
- `apps/desktop/src/lib/desktop-git.ts:43-47` already calls `/api/git/*`; Git is NOT presumed to require a new bridge.
- `apps/desktop/src/lib/desktop-fs.ts:55,105,158` already calls remote filesystem routes. Lines 161-179 distinguish local-only reveal/rename/trash from remote-ready read/write capabilities.
- `apps/desktop/src/contrib/plugins.ts:20` discovers shipped plugin files; excluding custom plugins must not exclude bundled features.

Lab traced `electron/terminal-ipc.ts` to local node-pty/SSH and distinguished the dashboard embedded-TUI `/api/pty` from a general Desktop shell. Ticket feasibility must independently verify this boundary before choosing a terminal adapter. Do not infer that any PTY endpoint satisfies persistent shell parity.

Studio recommends keeping existing V2 root positions as the lowest-risk baseline before deciding whether to consolidate. The five-tab shell below is a manager proposal, NOT a previously accepted UX decision. Also fix these observed navigation contracts in P2: Bots -> chat -> Back must return to Bots; root headers must expose active gateway context; offline/unconfigured states must not strand navigation.

## 4. Navigation decision: proposals, not approved design

### A. Evolved V2 shell (recommended)

Retain Board/Home entry and a small bottom navigation. Candidate five destinations: Home, Chats, Bots, Activity, Manage. Merge group access into Bots (with group rows and a visible group filter); merge routines/cron/activity under Activity only if labels and underlying types remain distinct. Manage provides categorized settings/capabilities rather than a wall of tiny icons.

- Home: device health, resume recent work, items needing attention. No fabricated fleet-wide readiness; stale/unknown state visibly labeled.
- Chats: current project/session browser, not a second fleet control center.
- Bots: bot/group roster with exact gateway/profile routing and agent detail management.
- Activity: live work, approval inbox, scheduled jobs/routines, with clear source/context.
- Manage: gateways, profiles, capabilities, messaging, settings and diagnostics.
- Files/Git/Terminal/Preview are contextual workspace tools opened from chat/project, not permanent extra tabs. Advanced global entry can also be discoverable from Manage/action catalog.

Tradeoff: smaller root bar and contextual tools, but moves Groups/Runs/Settings. Owner must approve discoverability and terminology against existing V2 before replacing navigation.

### B. Workspace-first mobile shell (comparison candidate)

Enter a resumable workspace instead of a device dashboard. Unlike A, use no persistent bottom tabs: Devices -> Workspace -> Conversations / Activity / Manage -> detail, with push navigation and a context selector for gateway/profile/project. Workspace tools expose files/review/terminal; an agent/workspace switcher handles concurrent work. Global management is a distinct destination, not mixed with transcript controls.

Tradeoff: faster project-heavy work and stronger contextual tooling, but a larger departure from approved Board-first behavior and more demanding multi-gateway orientation.

Compare both with identical sample content, same chat visual treatment, same tasks and mobile sizes. Do not present palette-only variants. No implementation decision until Owner uses the comparison.

## 5. Interaction contracts and acceptance journeys

All journeys require connected, empty/loading, failed, unauthorized, unsupported-version and reconnect variants where applicable.

- Resume: from Home, open recent work in one tap. History paints final text without token replay; draft/scroll preserved when returning from a tool view. Fresh profile drafts do not trigger invalid persisted-history requests.
- Context switch: choose another gateway/profile; name is visible before confirmation of destructive actions. Failed target connection leaves old workspace active. Same-named profiles never share data accidentally.
- Chat tools: attachments/model controls reachable from composer; opening preview or terminal does not submit a turn or discard draft. Mobile keyboard never covers send/stop or pending-approval actions.
- Queue: pause/edit/resume/delete map to upstream semantics. Network uncertainty must not auto-resubmit a prompt or duplicate an action. Reconcile authoritative outcome first.
- Approval: open pending item from an attention entry or its chat; show gateway, profile, session, command and allowed choices. Expired/resolved requests cannot be approved. API write confirmation is followed by state readback.
- Project work: chat -> changed files -> diff -> back restores transcript position; commit/push/revert/worktree removal require distinct confirmations and verified outcomes.
- Artifacts: browse generated output -> preview/download -> producing session with retained source identity; unsafe HTML never executes with app credentials.
- Bot/group: open exact canonical bot chat without a duplicate; group shows member/turn state and interruption/error outcome. Switching away/backgrounding must not silently report stalled orchestration as running successfully.
- Schedule: inspect job timezone, target profile, cadence and delivery destination before save; read back the exact saved target. Cron and API Runs remain different entity types.
- Configuration: visible `Applies to` identifies gateway/profile; switching active context resets stale edit scope. Secret inputs are masked; no credentials in screenshots/logs/export.
- Browser annotation: create/delete pins without sending; explicit add-to-composer preserves selector/crop/redaction semantics; submit remains a separate action.
- Background/reconnect: lock/unlock, app switch, gateway restart, Wi-Fi/cellular transition; reconcile running/completed/approval state without duplicate text, stale spinners or auth storms. OS notification guarantees require their own implementation and evidence.
- Failure: distinguish transport, auth, provider/billing and runtime errors; offer only safe/relevant recovery, and show stale cached information as stale.

### Measurable UX gates

- All inventoried feature actions have a reachable route or explicit blocker; no dead-end mockup destinations.
- Primary resume is one tap from its visible recent row. Pending approval detail at most two taps from the primary shell. Advanced management category at most three taps; count from defined start state and exclude authentication/data entry.
- Core journeys validated at widths 360, 390 and 430 CSS px; 320px overflow smoke and landscape keyboard checks. Use real iOS Safari and Android Chrome for behavioral signoff, not headless emulation alone.
- Targets at least 44x44 CSS px; WCAG AA text contrast; visible keyboard focus, dialog focus trapping/return, semantic labels/live states, reduced motion, 200% text scaling. Dense tables get intentional horizontal scroll; page shell does not.
- Prototype task test: Owner completes resume, change context, inspect file, resolve approval, find a bot routine, and locate capability settings without verbal routing. Capture confusion and revise once before approval.
- Performance baseline measured on a specified reference phone/network. Provisional target: cached navigation/feedback within 200ms; skeleton/status immediately for slower network work. Do not advertise measured performance until recorded.

## 6. Phased work packages and stop gates

This is a discovery-to-build roadmap, not permission to implement undefined APIs. Each approved package becomes small TDD tickets only after its source contracts and design are fixed.

### P0 — Close inventory and transport feasibility (lab + builder)

1. Enumerate pinned upstream nav/settings/command registrations and shipped built-ins.
2. Split every visible capability into user-action rows, including destructive operations and native-only affordances.
3. Trace each action to Desktop host/IPC and gateway/backend handler; record absence as unverified/blocked, not an invented endpoint.
4. Compare mobile call sites and tests against exact wire/scoping semantics.
5. Validate matrix structurally, then conduct human source-coverage review.
6. Resolve release/main differences and produce an explicit backend compatibility range.

Proposed files: `docs/parity/features.json`, `docs/parity/upstream-lock.json`, `docs/parity/native-boundaries.md`, `app/scripts/check-parity.mjs`.
Exit: reviewed inventory with no unclassified action; Owner reviews platform exceptions. Stop if literal full parity requires native/privileged architecture that Owner has not approved.

### P1 — UX comparison and complete flow prototype (studio)

1. Produce two route maps and same-task mobile layouts based on the validated matrix.
2. Build static, tap-navigable prototypes, clearly marked sample/mock data; deep links per screen/state.
3. Include all feature destinations and representative dense/error/approval states, not only attractive chat screens.
4. Validate navigation reachability, target sizes, overflow, contrast and screenshot appearance.
5. Owner chooses architecture using a compare hub on an approved preview route.

Proposed files: `design/parity-shell/index.html`, `design/parity-workspace/index.html`, `design/parity-compare/index.html`. Preserve existing `design/v2`, `v3`, `v4` and current compare until explicitly replacing them. No new network exposure; even an existing served-path publication requires Owner approval.
Exit: Owner-approved route map and interaction contract; not merely a color approval.

### P2 — Safe shell and scoped state (builder)

Likely files: `app/src/App.tsx`, `app/src/components/Header.tsx`, `app/src/components/TabBar.tsx`, `app/src/theme.css`, `app/src/screens/Home.tsx`, `Connections.tsx`, `Settings.tsx`.

1. Write failing route/context/back-navigation tests, then minimal shell implementation.
2. Introduce typed identity for gateway/profile/session/project and scoped drafts without reshaping proven transport prematurely.
3. Add supported-capability handling from verified contracts, preserving unknown/unsupported states.
4. Define versioned local-storage migration with fixtures for empty/legacy/corrupt states; no `localStorage.clear()` migration.
5. Re-run existing checks plus approved shell fixtures and rollback to old UI if scope/history regression appears.
Exit: existing chat/bot behavior unchanged and new shell passes same-device and cross-context journeys.

### P3 — Complete daily-work parity (builder, studio review)

Likely existing files: `ChatView.tsx`, `chat-view.css`, `ChatList.tsx`, `Bots.tsx`, `Groups.tsx`, `chat-resume-utils.ts`, `lib/hermes-client.ts`, `lib/active-sessions.ts`, `lib/group-driver.ts`, `lib/group-store.ts`.

Sequence: chat/composer/status/queue -> session/project navigation -> bot/group management -> files/artifacts -> Git/terminal/browser, with the latter blocked until transport feasibility is proven. New modules/screens receive exact paths in approved feature tickets, not speculative imports here.
For every action: failing wire test -> minimal adapter -> component/state fixture -> offline checks -> approved disposable live scenario -> parity evidence update.
Exit: each implemented row passes behavior/state/authority acceptance, including resume and failure variants.

### P4 — Management parity (builder + infra for privileged boundaries)

Capabilities, profiles/memory, schedules/routines, official Kanban, webhooks, Agents/Command Center, messaging, providers/settings, voice, language/appearance/accent/pets, notifications, lifecycle/support. Sidebar, palette-only and default-off bundled surfaces all remain covered. Keep `lib/runs-client.ts` separate from cron contracts. Design explicit read-only paths before mutating controls. No SSH bridge, credential broker, backend installer or core patch without architecture/Owner gate.
Exit: all scope/readback tests pass, secrets threat model reviewed, unsupported capabilities honestly surfaced.

### P5 — OSS hardening and release evidence (builder + independent review)

Proposed artifacts: browser integration tests, fixtures, compatibility matrix, CONTRIBUTING.md, SECURITY.md and release checklist; exact CI file/tooling selected only after P0 contracts and test dependency review.
Checks: existing bot/resume tests; typecheck; lint warnings triage; production build in disposable unserved output/worktree; protocol tests; mobile-browser E2E; accessibility; offline/background/slow-network; authorization and cross-profile isolation; upgrade/migration; clean-install reproduction; license/attribution and redacted docs.
Exit: zero unresolved critical/high release-blocking defects; every in-scope parity action verified or explicitly unresolved (unresolved means no full-parity claim); Owner approves release/commit/push/publication. No build overwrites a live-served `app/dist` incidentally.

## 7. Pipeline Design Gate (proposed bounded workflow)

| Stage | Input | Output artifact | Owner/profile | Deterministic validation |
|---|---|---|---|---|
| Inventory | pinned upstream + mobile snapshot | feature matrix/source lock | lab, builder contract review | required schema, unique IDs, pin/path checks, complete registration enumeration |
| UX design | validated matrix + Owner goals | route manifest + two static prototypes | studio | each feature mapped; no dead links; viewport/target/overflow checks; screenshot receipt |
| Owner selection | comparable prototype task results | approved option + change notes | Owner; default records gate | explicit decision present, unresolved decisions listed |
| Feature implementation | approved small ticket/source contract | code + tests + evidence | builder | failing-then-passing tests, typecheck/lint/build, scope checks |
| Runtime proof | approved exact scenario | readback/transcript/test receipt | builder; infra if operations | source target IDs and final state verified, no duplicate mutations |
| Release | validated matrix + test bundle | versioned artifact/checklist | default QA, Owner publication | clean install, browser coverage, critical gates, exact artifact identity |

- **Source of truth/state:** this plan now; later proposed `docs/parity/` matrix/lock and per-ticket evidence under `docs/parity/evidence/`. Runtime truth stays on gateways; browser preferences never become job/session authority.
- **Failure/retry:** source fetch max two retries, then alternate official source or explicit blocker. Deterministic test failure stops that ticket. One bounded design revision after Owner feedback before re-scope. Never retry a possibly accepted remote mutation without readback/idempotency proof.
- **Rollback:** preserve old UI and storage compatibility in scoped worktree/commits; failed feature does not replace working screen. Reverting/deploying rollback and remote restoration require Owner authority; no automatic backup/restore operation is authorized.
- **Authority:** current approval covers local inventory/prototype/QA and, after checks, publishing new static preview subfolders on existing Tailnet :8450 plus commit/push to a separate prototype branch. Owner gates remain for navigation choice/app migration, native/bridge architecture, installs/access/runtime writes, new network exposure, restart/update, backups, destructive actions and spending. No Hermes core modifications or changes to live app :8451.
- **Model tier/escalation:** deterministic runners for enumeration/schema/tests; standard coding/design tier for bounded tickets. Frontier reasoning only for unresolved cross-surface/security design, maximum one escalation review plus one correction per milestone; further rounds stop for Owner budget approval. No custom per-stage system prompts; durable profiles/project rules and short task contracts.
- **Cost/cadence:** one-shot planning now; no cron or ongoing agent loop. Later offline checks per ticket, CI per change and release candidate only after approval. No paid provider/API/browser service or cloud resource assumed. Runtime prompts/install/download costs must be bounded in each approved scenario; current work has no metered runtime test.
- **Dry-run evidence now:** public docs/main/release lookups succeeded via fallback; existing bot and resume tests passed; lint exit 0 with warnings; source routing inspected. Matrix validator, prototypes, new browser tests and release automation DO NOT exist yet and have no passing evidence.
- **Gate verdict:** accept this as a planning proposal. Full pipeline build approval is withheld pending inventory completeness, native boundary decisions, mockup choice and ticket-specific validators. No vague feature family can enter implementation without its action-level contract.

## 8. Delivery definition

The next deliverable is a verified action inventory plus reviewable mobile flow prototypes, NOT an immediate UI rewrite. A later full-parity claim requires all pinned Desktop built-in actions to be covered with passing evidence; Owner-accepted phone equivalents are reported separately from literal native behavior. Any native-only blockers remain visible, and no dashboard feature or custom plugin is used to inflate completion.
