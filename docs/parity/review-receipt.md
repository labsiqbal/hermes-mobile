# Prototype review receipt

Validated review package, not production parity. Owner design choice and app migration remain separate gates.

## Review entry

https://nuc.tailcf7779.ts.net:8450/reviews/desktop-parity/parity-compare/

Open A / Open B gives a standalone phone view. All preview data is fictional and local-only. Source branch: `ux/mobile-parity-review`; current app remains on its existing baseline.

## Verified evidence

| Gate | Observed result | Evidence |
|---|---|---|
| Source inventory | 229 action rows; 49 pinned sources; incomplete inventory, 0 runtime-verified rows | `features.json`, `upstream-lock.json`, `evidence/source-presence.json` |
| Inventory validator | Actual route manifest accepted; 33 malformed fixtures rejected | `node app/scripts/check-parity.mjs --routes design/parity-routes.json --self-test` |
| Baseline browser suite | 129 cases, 1,246 checks, 0 failures; 7 screenshots | `evidence/browser/report.json` |
| Extended browser suite | 324 checks, 232 route/viewport cases, 58 pointer palette destinations; 0 failures | `evidence/browser/extended-report.json` |
| Navigation/context regressions | Four UI defects failed in both candidates before correction, then passed; missing-confirmation negative fixture now fails correctly | `reviews.md`, `evidence/regression-red.json`, `evidence/confirmation-red.json`, `evidence/harness-self-test.json` |
| Static-host URL adapter | 6 offline mapping cases pass; no initial wrong-path iframe request | `evidence/entry-paths.json` |
| Actual HTTPS rendering | Fresh-profile Chrome renders new hub; both links and iframes resolve to correct directory URLs | `evidence/served-browser.json`, `evidence/browser/served-compare-390x844.png` |
| Served bytes | All five published files match source SHA-256 | `evidence/publication-readback.json` |
| Live app protection | HTTP 200; served and local `app/dist/index.html` retain baseline SHA-256 `96121582978238d85ec631ab2168db880043b930cd7030d51af51df4923d177b` | `evidence/publication-readback.json` |
| Existing app checks | Bot/resume checks PASS; existing lint exits 0 with existing warnings | `evidence/existing-app-checks.txt` |
| Final source freeze | Input hashes recorded after final checks; no `app/src`, package, or app build-output changes | `evidence/validated-inputs.json` |

Visual review confirmed distinct root architectures, unobstructed composer/context, readable comparison controls and corrected heading focus treatment. An apparent bottom cutoff was verified as normal scrolling: main content ends at the navigation boundary and final rows remain accessible at maximum scroll.

## Delivery corrections

The initial static-host byte check caught nested `index.html` URLs redirecting to the old preview root. HTTP(S) now uses directory URLs; file previews keep explicit filenames. No service configuration was changed.

A fast bulk hash loop triggered Chrome's navigation flood-protection warning. The test now isolates viewport fixtures and waits for the requested rendered route; browser protection remains enabled. The failed report is retained in `evidence/hash-loop-failure.json`, followed by an independently rerun passing suite. This was not hidden with a blind successful retry.

## Boundaries

- Preview publication and separate-branch commit/push were Owner-approved; no app cutover, new port/service, credentials/access change, paid service, live agent prompt, or Hermes core modification.
- Live app baseline: `9b25ec831e144ff5182978002d4bbb2ddb6521f1`. Existing designs and app remain intact; preview files are additive under `design/reviews/desktop-parity` in the canonical working directory.
- New scripts lint without warnings; pre-existing app warnings remain documented, not silently called clean. No CI-green claim.
- Actual iOS/Android, virtual keyboard, assistive technology, background/resume and real gateway/native feature behavior are not established by these prototypes. They remain separate device/runtime validation gates.
- Worktrees are retained. Cleanup, production migration and further architecture decisions require Owner direction.
