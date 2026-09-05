# Production quality gate — HM-PROD-01

This gate validates the **built React Shell A**, not the HTML design prototypes.
A successful fixture run is required for release, but is not authenticated gateway
or physical-device proof. CI never publishes the app or sends a live agent prompt.

## Reproducible toolchain

Use Node **22.23.2**, the exact CI version. Installed dependency metadata from the
existing lockfile establishes the Node requirements:

| Installed package | Version | `engines.node` |
| --- | --- | --- |
| Vite | 8.2.2 | `^20.19.0 || >=22.12.0` |
| `@vitejs/plugin-react` | 6.1.0 | `^20.19.0 || >=22.12.0` |
| Oxlint | 1.80.0 | `^20.19.0 || >=22.12.0` |
| Rolldown | 1.2.5 | `^20.19.0 || >=22.12.0` |
| TypeScript | 6.0.3 | `>=14.17` |
| esbuild | 0.28.2 | `>=18` |

Do not infer Node support from the Vite major or from `@types/node`. The gate pins
a compatible Node version without changing the package version, dependency ranges,
root lockfile metadata, or adding packages. The lockfile remains authoritative.

CI uses the standard public `ubuntu-24.04` runner, not a paid/larger or self-hosted
runner. Its [published image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
lists preinstalled Google Chrome. Chrome/image versions can change: the workflow
prints the actual Chrome version and fails if `/usr/bin/google-chrome` is absent or
cannot execute. It does not install a browser or silently skip browser validation.
Node/dependencies are pinned; this is not a claim of a byte-identical OS/browser.

## Exact local commands

Run from the repository root, in an isolated checkout containing **all** production
lanes, with Google Chrome already installed at `/usr/bin/google-chrome`:

```bash
cd app
node --version
npm --version
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run lint
npm run test:unit
npm run build
/usr/bin/google-chrome --version
npm run check:management:browser
npm run check:chat-reveal
BROWSER_OUTPUT="$(mktemp -d /tmp/hermes-production-browser.XXXXXX)"
npm run check:shell-navigation -- "$BROWSER_OUTPUT/navigation"
npm run check:production-browser:self-test -- --output "$BROWSER_OUTPUT"
npm run check:production-browser -- --output "$BROWSER_OUTPUT"
```

`--include=dev` is intentional: build/test tools are devDependencies and may
otherwise be omitted by a production-oriented environment. `--ignore-scripts`
disables dependency lifecycle scripts; the existing locked Linux native packages
suffice for esbuild, Oxlint and Vite (verified locally). No `npm install`, package
update, browser downloader, `npx` download, or new dependency is part of the gate.
Other OS/architecture combinations have not been verified with this install mode.

`npm test` aliases `npm run test:unit`. CI additionally runs the static publisher's
Python standard-library tests from the **repository root**, not `app/`:

```bash
test -f deploy/publish-static.py
test -f deploy/test_publish_static.py
python3 -m unittest discover -s deploy -p 'test_*.py'
```

The explicit file checks prevent a missing publisher lane from looking green via
empty test discovery. The tests use temporary trees and injected route/HTTP reads;
they must not run the publisher CLI, contact the real serving target or deploy.
The canonical static publication target is the main checkout's `app/dist`, not a
candidate worktree; publication remains a separate parent/infra gate documented by
that lane in `docs/production/static-publication.md`. Publisher implementation/tests
must be integrated before this workflow can pass; they were not executed here.

The JavaScript unit aggregate runs, in order:

1. `npm run check:bots` — existing bot title/preview contracts.
2. `npm run check:chat-resume` — existing resume/history/event contracts.
3. `npm run check:shell-state` — navigation identity/history and scoped conversation
   state contracts (`scripts/check-shell-state.mjs`).
4. `npm run check:management` — management transport/confirmation fixtures
   (`scripts/check-management.mjs`).
5. `npm run check:workspace` — contextual workspace public-boundary fixtures
   (`scripts/check-workspace.mjs`).

Each command fails normally if its script/source is missing. There is no
`--if-present`, optional lane, or success fallback. `npm run build` includes
`tsc -b` before Vite. Lint retains the repository's current Oxlint policy: errors
fail, existing warnings are printed; a passing exit code does not mean zero warnings.

## Browser fixture boundary

The browser gate's entry point is `scripts/check-production-browser.mjs`, with
`--app-dir <app-root>` and `--output <evidence-directory>`. It must exercise the
fresh `app/dist` bundle produced immediately before it. Prototype checks and old
screenshots cannot substitute for this gate.

The production QA harness owns the detailed assertions and receipt. Its contract
is a fresh disposable Chrome profile over a debugging pipe, an ephemeral loopback
fixture server, and intercepted deterministic gateway responses. No real gateway,
config file, browser profile, saved credential, or native bridge is an input.
Only the harness's actual assertions/evidence establish which flows were checked;
fixture responses do not demonstrate that a live server accepts those requests.

The self-test validates the harness/fixture guards where implemented; it is not a
substitute for running the browser against the integrated production app. Inspect
browser assertions, console/network failures, screenshots and cleanup evidence.
Keep the output outside the repo and do not place authenticated artifacts there.

## CI policy and evidence

`.github/workflows/check.yml` runs on every pull request and pushes to `main` or
`feat/shell-production`. There are no path filters: changes to tests, dependencies,
workflow or production documentation still get validation. Fork PRs use the normal
read-only `pull_request` context, never `pull_request_target`.

- Repository permission is only `contents: read`; checkout does not persist its
  credential. No configured secrets, deployment permissions or live endpoints.
- Job timeout: 20 minutes. Browser self-test: 2 minutes. Browser fixture run:
  6 minutes. Any failing check blocks subsequent success.
- New runs may cancel stale PR/candidate work, but `main` validation already in
  progress is not cancelled. GitHub concurrency may still replace queued runs;
  this does not promise that every intermediate main commit starts a run.
- Browser evidence is uploaded after success or failure once either the self-test
  or browser step was attempted, with seven-day retention, hidden files excluded,
  and missing evidence treated as an error. It contains fixture output only, not an
  authenticated trace.
- No automated retry, dispatch, deployment, service restart, or gateway smoke is
  hidden in an aggregate command. At most two scoped correction rounds are allowed
  by the canonical backlog; unresolved failures are reported, never waived as green.

Third-party action references were verified with public, read-only upstream tag
lookups (`git -c credential.helper= ls-remote <url> refs/tags/<tag>`):

| Upstream | Tag | Verified commit |
| --- | --- | --- |
| `https://github.com/actions/checkout.git` | `v4.2.2` | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `https://github.com/actions/setup-node.git` | `v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `https://github.com/actions/upload-artifact.git` | `v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

There is no `.no-mistakes.yaml`: workspace standards name that delivery mode but
no actual schema, runner convention, or example was found. This executable GitHub
workflow is the gate, not a pretend configuration file. Workflow presence alone
also does not configure GitHub branch protection or prove that CI has run.

## Release proof still required

Never put `npm run smoke` in CI or `npm test`: it is the separate,
credential-consuming live smoke path and is **not authorized by fixture testing**.
Authenticated gateway reads/mutations need a separate approved test scope. Physical
iOS Safari/Android, native bridges, virtual keyboard, safe areas and touch behavior
must remain explicitly unverified unless actually exercised. Headless viewport
coverage does not constitute physical-device or complete accessibility proof.

Before the parent claims HM-PROD-01 complete:

1. Integrate the shell, management, workspace and production QA source/test lanes.
2. Run the exact clean-install sequence above against that integrated commit; any
   missing script, Chrome failure or red assertion blocks release.
3. Review the produced screenshots/receipt and complete independent standards/spec
   review. Bound fixes to the backlog's two correction rounds.
4. Record real CI status after the parent performs the authorized source push.
   No remote CI run has been dispatched or claimed by this release-engineering lane.
5. Separately verify the approved publication target and exact served artifact;
   source/build/fixture success is not deployment or authenticated transport proof.

### Release-engineering lane verification status

In the isolated `production-release` worktree based on `9b25ec8`, clean lockfile
installation with devDependencies, existing bot checks, existing resume checks,
Oxlint (with pre-existing warnings), and TypeScript/Vite build passed. The lockfile
and dependency declarations remain unchanged. These checks validate the baseline,
**not the fully integrated Shell A**. New unit and browser script names/options were read from their owning worktrees
before wiring them; their source is not copied here. Workflow YAML/policy assertions,
CI script resolution, package/lock compatibility and Chrome preflight positive and
missing-binary negative checks passed. `npm run test:unit` exited 1 at the absent
`check-shell-state.mjs`; both browser commands exited 1 at the absent
`check-production-browser.mjs`. These are expected integration blockers, not green
unit/browser runs. Full execution must be performed by the parent after integration.
Do not describe this lane's partial local checks as a green production release or
end-to-end result. Dependency audit was deliberately disabled with `--no-audit`;
no audit was performed and no security-clean dependency claim is made.
