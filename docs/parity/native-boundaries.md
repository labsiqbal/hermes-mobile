# Desktop / phone authority boundaries

No bridge, service, native wrapper, runtime change or platform exception is approved here.
All references below use Desktop main `9dd6634c5635321cf38840cc30e9b51226689128`.
Native blockers remain in the inventoried denominator; a proposed phone equivalent is not
literal parity or an Owner-accepted exclusion.

## Existing remote surfaces — do not invent replacement backends

**Git already has remote REST.** The [Desktop Git facade](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/lib/desktop-git.ts)
selects local Electron Git or `/api/git/*`; the [router](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_cli/web_routers/git.py)
contains status, branches, worktrees, review list/diff/stage/unstage/revert/commit/push/create-PR
and worktree add/remove/branch-switch. Browser transport, repo authorization, `git`/`gh`
availability, explicit target confirmation and mutation readback remain untested.
A backend endpoint is not permission to commit, push, delete or create a PR.

**Workspace files are partly remote-ready.** The [filesystem facade](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/lib/desktop-fs.ts)
and [files router](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_cli/web_routers/files.py)
provide directory listing, text read/write, data-URL preview and download routes. Desktop
reveal, rename and recoverable OS trash helpers are explicitly local-only. Managed-root
`/api/files` upload/delete is not proof of arbitrary workspace rename/trash equivalence.
Do not conflate server paths, Desktop-local paths and phone-selected `File` objects.
Profile and Kanban archive transfer currently accepts backend paths; phone byte transfer
needs its own contract. Preserve path hardening, size limits, stale-on-disk checks and
safe preview isolation; never render untrusted HTML with app credentials.

**Management REST is not ordinary chat RPC.** [api/client.ts](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/api/client.ts)
routes REST through `window.hermesDesktop.api`, carrying connection/profile scope.
A browser needs an authenticated HTTP adapter rather than a copied Electron import.
A profile name alone is not globally unique. Unknown routes/payloads remain unknown.
Cron, Bot routines, Agents/Command Center and `/v1/runs` are different workflows;
existing mobile Runs tracking does not establish schedule-management parity.

## Real native/host constraints

| Outcome | Source ownership and honest phone boundary |
|---|---|
| Persistent terminal shells | [terminal-ipc.ts](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/electron/terminal-ipc.ts) starts `node-pty`, locally or SSH through a local PTY; attach/write/resize/dispose are IPC. [chat_ws.py](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_cli/web_routers/chat_ws.py) `/api/pty` embeds Hermes TUI, not an interchangeable general Desktop shell. No shell adapter is proven. Hiding a panel must not terminate a shell. |
| Browser annotation | [preview-annotate-host.ts](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/app/chat/right-rail/preview-annotate-host.ts) executes scripts in Electron guest views and captures crops. Phone iframes cannot arbitrarily inspect cross-origin DOM/CSS/pixels. Element/region pins, redaction and explicit add-to-composer must survive any approved redesign; external links alone fail the requirement. Teardown is local overlay state, not a privileged remote deletion. |
| SSH / Cloud registry | [preload.ts](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/electron/preload.ts) owns SSH config/resolution and cloud discovery/login IPC. Browser-friendly connection selection is only proposed; neither a phone SSH implementation nor cloud auth adapter has been established. |
| OS affordances | The same preload exposes multiwindow, global Quick Entry, always-on-top HUD, underlying-window context, pet overlays, keychain, keep-awake, client updates, bootstrap repair and uninstall. A web page cannot promise those literal host operations. Native-only rows remain blocked pending Owner decisions. No documentation claim about encryption defaults is used as a security guarantee. |
| Notifications / voice | Phone microphone capture, speech formats/playback and notifications require explicit permissions, secure origin, OS support and real-device testing. Desktop native notification behavior is not proof of background phone delivery. Recording must be visible; interrupted capture must not silently continue. |

## Bundled and client-owned behavior

[Bundled discovery](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/contrib/plugins.ts)
includes **Bot Mode** (on), **Kanban** (off) and **Accent** (off). Excluding custom runtime
plugins must not remove these requirements. Kanban uses scoped `/api/plugins/kanban/*`
calls and board-specific selection, not a new backend. Accent is scratch color state:
reset/disabling/reload returns to the authored theme; it is not persisted configuration.

Desktop queues are client-owned. [composer-queue.ts](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/apps/desktop/src/store/composer-queue.ts)
park/unpark is not a gateway queue API. Bot Mode group state mixes client logs with a
server projection; hydration resets running/epoch. Gateway-persisted data does not prove
that an orchestrator keeps executing while a phone browser is suspended. Wake Lock is
not a substitute for backend-owned background orchestration.

## Required approval and proof before implementation

1. Specify the outcome and exact gateway/profile/project/session or host target. Choose direct
   web, proposed equivalent, bridge-required or native-only without dropping the original action.
2. Owner approves any new host/native/auth architecture or exception. Action-level user gestures
   and confirmations remain separate: sensitive reads, credentials, push/PR, archive import,
   destructive operations and privileged lifecycle effects need explicit scope and consent.
3. Prove transport, version compatibility, auth isolation, failure and uncertain-write readback.
   Never invent a gateway endpoint or automatically repeat an ambiguous mutation.
4. Execute acceptance tests on actual supported phone browsers, including suspension/reconnect,
   expired approvals and state preservation. Only then attach evidence; static prototypes and
   this source audit do not qualify. Stable/main compatibility is still unverified.
