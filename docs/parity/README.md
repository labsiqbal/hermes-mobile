# HM-UX-01 — Desktop action inventory

**Bounded source audit, not a complete inventory, implementation claim or release gate.**
`features.json` deliberately sets `inventory_complete: false`. Every action has an
upstream source anchor, a proposed mobile route and an explicit unresolved reason.
No row is verified; prototype screens and source inspection are not functional evidence.

## Inputs and scope

- Current Desktop baseline: `9dd6634c5635321cf38840cc30e9b51226689128`.
- Separate stable release: `v2026.8.31`, commit `29112bef099274229cadff79cdff7bf7b99c4b77`.
- Mobile planning baseline: `9b25ec8`. Existing mobile callsites were **not** fully compared here.
- Official [Desktop docs](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
  and [multi-connection docs](https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop)
  supply context; per-row pinned source controls the action/transport claim. Docs are live,
  not a versioned guarantee that each linked page describes every granular action.
- Include official core and bundled Bot Mode, Kanban and Accent. Default-off is not
  out of scope. Custom third-party/local runtime plugins are explicitly excluded.
- Read-only public GitHub tree/raw source audit only. Source hashes in the lock identify
  retrieved UTF-8 contents, **not** test receipts. No local Hermes config, tokens or runtime accessed.
- Stable/main action diff was not performed. Every `release_status` is `unverified`;
  no minimum supported backend version is asserted.

## Files and validation

```sh
# From repository root; Node 22, no npm install or package script needed.
node app/scripts/check-parity.mjs
node app/scripts/check-parity.mjs --self-test
# After the separately built HM-UX-02 route manifest is present:
node app/scripts/check-parity.mjs --routes design/parity-routes.json --self-test
```

The validator resolves inventory/lock relative to its own repository, not shell cwd.
`--routes` resolves relative to shell cwd, parses the actual JSON, checks schema version,
unique route IDs, title/kind, shell/workspace variants, roots and safe relative HTML entry
paths, then validates **every** row destination against it. This validates the manifest,
not HTML existence, links, clickability or browser behavior. Without it, output explicitly
says `embedded-contract`; no prototype is presumed present. Unknown flags and unreadable
or malformed JSON exit nonzero. Actual CLI checks accepted a temporary valid route JSON
fixture (exit 0), rejected malformed JSON and a missing referenced route (exit 1), then
removed the fixtures. That is parser coverage, not HM-UX-02 prototype integration.
The separate `parity-negative-fixtures.mjs` contains only
in-memory mutations; self-tests never write fake evidence files.

### Actual initial validator result

| Metric | Count |
|---|---:|
| Inventoried action rows | 229 |
| Current status: unverified / blocked / verified | 205 / 24 / 0 |
| Platform: direct-web / proposed equivalent / bridge-required / native-only | 175 / 30 / 13 / 11 |
| Contract: client call traced / handler traced / unknown / not applicable | 137 / 18 / 48 / 26 |
| Pinned source files / inspected registration entrypoints | 49 / 10 |
| Closed registration lists / unclosed entrypoints / open work items | 3 / 7 / 8 |
| Planned test references / functional evidence receipts | 229 / 0 |
| Used route IDs / agreed route IDs | 27 / 29 |
| Negative fixture mutations rejected | 33 |

These counts are computed by the validator, not independent completeness claims.
The 3 closed lists are **only** core route IDs, bundled-discovery file matches and
settings section IDs. Their child actions are not closed. Row count is not the total
number of Desktop actions, and no coverage percentage is reported. Native/bridge rows
are included in the row count; do not subtract them to inflate parity. All release states
remain unverified and `release_ready` remains false.

## Schema and interpretation

`features.json` is `{schema_version, baseline, inventory_complete, features}`.
Each row carries the plan's required fields plus `title`, `desktop_source_url` and
`platform_disposition`. The validator enforces required fields, enums, unique IDs,
pinned URL/path/symbol membership in the source lock, routes and test-reference syntax.

- `current_status`: `unverified`, `missing`, `partial`, `implemented-unproven`, `verified`, `blocked`.
  This audit uses unverified rather than claiming an existing mobile implementation is missing.
- `target_status`: same vocabulary. Most target verified; literal native-only targets remain
  blocked pending an Owner decision, **not** accepted exclusions.
- `platform_disposition`: `direct-web` means a plausible browser surface, not tested compatibility;
  `mobile-equivalent-proposed` is not accepted equivalence; `bridge-required`/`native-only`
  preserve the original requirement. See [native boundaries](native-boundaries.md).
- `desktop_transport`: `{kind, detail}` distinguishes REST-via-Electron, JSON-RPC, IPC,
  client-local and mixed ownership. `gateway_contract` carries `{status, detail, sources}`;
  traced calls also carry method/endpoint. Path placeholders are explanatory, not executable URLs.
  `client-call-traced` is not proof of handler schema, authorization or deployed availability.
  `handler-traced` here means static Git/files facade plus router inspection, not runtime testing.
  `unknown` is deliberate; never turn it into an invented endpoint.
- `scope` states the intended owning context; full wire scoping still needs contract proof.
  `authority.owner` identifies durable authority, and `mutation` describes semantic effects,
  not the HTTP verb: credential reveal is a sensitive read despite using POST.
- `authority.gate`: `read-only` permits only approved reads; `user-action` requires an explicit
  user gesture; `confirm-target` requires explicit Owner/user confirmation naming the resource,
  gateway/profile and effect (including disclosure, remote push or destruction). It is **not**
  agent auto-permission. `owner-approval` requires separate scope/architecture/privileged-action
  approval. These are proposed future UX controls, not authorization to execute anything now.
  Architecture approval for an annotation bridge is separate from an ordinary local draft gesture.
- `planned:HM-UX-01:<action-id>` references describe proposed acceptance tests, not files or
  tests that already exist. They must become executable behavior tests before promotion.
- `evidence` stays `[]` until actual execution. Future `executed:` test IDs require matching
  receipts with result, command, timestamp, environment, full mobile SHA, and a nonempty artifact
  under `docs/parity/evidence/` whose SHA-256 matches. Verified needs passing evidence for every
  referenced test, no planned IDs and no blocker. The validator checks files/hashes, not whether
  a human-authored receipt tells the truth or proves semantic parity; independent review remains required.

## Closing the audit

`upstream-lock.json.source_audit` is the audit ledger. `entrypoints` records observed
registration names and tightly scoped closure; `open_enumeration` names unfinished work.
It explicitly retains dynamic palette/keybindings, all settings fields, bundled child actions,
workspace/annotation/terminal detail, transport/auth/version contracts, release diff, mobile proof
and Owner platform decisions. A row may group a reversible toggle, but status transitions or
separate destructive operations must be split as their semantics are audited.

Next milestone: reconcile those lists into actions, trace exact contracts, compare mobile code,
then implement and execute scoped acceptance journeys (reconnect, errors, authorization,
readback, background behavior and real phone interaction included). This validator intentionally
refuses an `inventory_complete: true` or reviewed-release promotion: enabling those claims needs
a reviewed enumeration/release-receipt schema, not merely clearing the open-work array.
