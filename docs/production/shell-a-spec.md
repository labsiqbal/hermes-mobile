# Shell A production acceptance contract

Owner selected **A — Shell** and requested production implementation plus commit/push after verification on 2026-09-06. This is a real React migration, not publication of prototype HTML.

## Sources and scope

- Mobile baseline: `9b25ec831e144ff5182978002d4bbb2ddb6521f1`.
- Approved design, source inventory and prototype evidence: [review commit 46c10ad](https://github.com/labsiqbal/hermes-mobile/tree/46c10ad4c206fd04c5b13ed593deeb1c11e9aecc).
- Official Desktop main: `9dd6634c5635321cf38840cc30e9b51226689128`. Stable release comparison remains unverified; Desktop package version is not the Hermes release version.
- Task queue and execution/authority gate: canonical workspace `backlog.md`, HM-PROD-01.

The product target remains all official Desktop features, including bundled Bot Mode, Kanban and Accent. This client release must distinguish working browser implementations from unsupported native transports and unimplemented actions. An available screen, a passing fixture, or an inventoried action does not establish full Desktop parity.

## Acceptance

| ID | Observable requirement | Required evidence |
|---|---|---|
| PA-01 | Exactly five primary destinations: Home, Chats, Bots, Activity, Manage | Built React browser assertions and screenshot |
| PA-02 | Existing connections, session list/project expansion, chat, bot and group flows remain reachable; Groups is within Chats | Existing bot/resume checks plus browser journeys |
| PA-03 | Chat streaming, model selection, approvals and canonical Bot Chat reuse the existing client contracts | Existing tests, source review and explicit fixture journeys; live behavior reported separately |
| PA-04 | Gateway/profile/conversation identity survives contextual Workspace navigation and browser Back/Forward; unrelated contexts never inherit a draft or model | Deterministic state tests and actual browser regression |
| PA-05 | Draft and scroll survive leaving a chat for contextual tools and returning | Built browser journey; no secret-bearing connection objects in History state |
| PA-06 | Workspace Files/Git actions use traced remote contracts, scoped to an explicit session/project; absent context or unavailable API is a clear failure, not a local fallback | Sourced contract and request/security tests |
| PA-07 | Manage provides source-backed reachable management surfaces with visible loading, empty, failure and unsupported states | Contract tests plus built browser journeys |
| PA-08 | Native terminal, SSH/OS integration and annotation are not simulated or represented as working equivalents without an approved adapter | Source/spec review of boundaries |
| PA-09 | Mutating UI actions identify the target and require a deliberate confirmation where destructive or privileged; failed/uncertain operations are not automatically retried | Confirmation and failure tests; no real remote mutation during fixture QA |
| PA-10 | Narrow and landscape layouts do not overflow horizontally; primary touch controls are at least 44px, keyboard/escape interactions remain usable | Browser checks at 360/390/430 portrait and 844x390 landscape; visual review |
| PA-11 | Production code has no fictional gateway/session data, raw secret/config dumps, or prototype simulation state | Source review and bundle/browser inspection |
| PA-12 | TypeScript, lint, existing/new deterministic checks, production build and built browser checks pass; standards/spec findings are resolved or explicitly block release | Executed commands, reports, reviewed source hashes |
| PA-13 | Published source SHA and served static entry/assets are independently read back; previous hashed assets remain available during client refresh | GitHub/CI readback and publication receipt |

## Release and evidence boundaries

Implementation lanes own isolated worktrees; source integration and final approval belong to the manager. Test fixtures use a disposable browser profile and a loopback-only temporary server, never a live gateway or stored credentials. No service restart, Tailscale route change, native bridge, credential/access mutation, paid service or live agent prompt is authorized by this migration.

The existing mobile static bundle can be replaced only after the candidate passes the release gate and the existing serving root is verified. A failed publication check stops delivery; rollback/restore needs a separate Owner decision. The old main commit remains reachable.

Authenticated production actions, actual iOS/Android suspension/keyboard behavior and assistive-technology signoff remain **unverified** unless a receipt records their real execution. Known credential-storage limitations remain explicit. Production Shell A delivery must not be described as complete official parity or a general OSS-production-readiness certification.
