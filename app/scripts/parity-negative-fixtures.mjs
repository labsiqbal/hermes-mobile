// Mutations of the actual validated inventory, never fabricated passing evidence.
export const negativeFixtures = [
  ['missing required field', c => { delete c.inventory.features[0].authority }, /authority/],
  ['duplicate feature id', c => { c.inventory.features.push(structuredClone(c.inventory.features[0])) }, /duplicate feature id/],
  ['invalid status', c => { c.inventory.features[0].current_status = 'done' }, /current_status/],
  ['invalid target', c => { c.inventory.features[0].target_status = 'ship-it' }, /target_status/],
  ['invalid scope', c => { c.inventory.features[0].scope = 'everywhere' }, /scope/],
  ['invalid family', c => { c.inventory.features[0].family = 'unknown-family' }, /family/],
  ['invalid transport', c => { c.inventory.features[0].desktop_transport.kind = 'magic' }, /desktop_transport/],
  ['invalid gateway status', c => { c.inventory.features[0].gateway_contract.status = 'works' }, /gateway_contract/],
  ['invalid authority', c => { c.inventory.features[0].authority.gate = 'automatic-root' }, /authority/],
  ['invalid platform disposition', c => { c.inventory.features[0].platform_disposition = 'excluded' }, /platform_disposition/],
  ['moving source ref', c => { c.inventory.features[0].desktop_source_sha = 'main' }, /source pin/],
  ['moving source URL', c => { c.inventory.features[0].desktop_source_url = c.inventory.features[0].desktop_source_url.replace(c.lock.main.sha, 'main') }, /source URL/],
  ['unlisted source path', c => { c.inventory.features[0].desktop_source_path = 'apps/desktop/imaginary.ts' }, /audited source/],
  ['unlisted source symbol', c => { c.inventory.features[0].desktop_symbol = 'inventedSymbol' }, /audited symbol/],
  ['unpinned stable baseline', c => { c.inventory.baseline.stable_sha = 'v2026.8.31' }, /stable baseline/],
  ['unreviewed release claim', c => { c.inventory.features[0].release_status = 'in-stable' }, /release comparison/],
  ['invalid release enum', c => { c.inventory.features[0].release_status = 'latest' }, /release_status/],
  ['verified without evidence', c => { c.inventory.features[0].current_status = 'verified' }, /verified.*evidence/],
  ['fabricated evidence receipt', c => {
    const f = c.inventory.features[0]
    f.current_status = 'verified'
    f.acceptance_test_ids = [`executed:HM-UX-01:${f.id}`]
    f.evidence = [{ test_id: f.acceptance_test_ids[0], result: 'pass', artifact: 'docs/parity/evidence/does-not-exist.json', sha256: '0'.repeat(64), command: 'node nonexistent-test.mjs', executed_at: '2026-09-05T00:00:00Z', environment: 'negative fixture only', mobile_source_sha: '0'.repeat(40) }]
  }, /evidence artifact/],
  ['unsupported route', c => { c.inventory.features[0].mobile_route = 'dashboard-tui' }, /mobile_route/],
  ['missing actual route', c => { c.routes.routes = c.routes.routes.filter(r => r.id !== c.inventory.features[0].mobile_route) }, /mobile_route/],
  ['duplicate actual route', c => { c.routes.routes.push(structuredClone(c.routes.routes[0])) }, /duplicate route/],
  ['malformed actual route schema', c => { c.routes.schema_version = 2 }, /route schema_version/],
  ['bad variant root', c => { c.routes.variants[0].root = 'not-a-route' }, /variant root/],
  ['bad variant entry', c => { c.routes.variants[0].entry = '../outside.html' }, /variant entry/],
  ['unsupported test reference', c => { c.inventory.features[0].acceptance_test_ids = ['looks-tested'] }, /acceptance_test_ids/],
  ['empty planned tests', c => { c.inventory.features[0].acceptance_test_ids = [] }, /acceptance_test_ids/],
  ['undocumented exclusion', c => { delete c.lock.scope.excluded[0].reason }, /exclusion/],
  ['false complete claim', c => { c.inventory.inventory_complete = true }, /inventory_complete/],
  ['empty blocked reason', c => { c.inventory.features.find(f => f.current_status === 'blocked').blocker = '' }, /blocker/],
  ['malformed row object', c => { c.inventory.features[0] = null }, /feature object/],
  ['malformed contract sources', c => { c.inventory.features[0].gateway_contract.sources = 'not-an-array' }, /gateway_contract.sources/],
  ['duplicate audit id', c => { c.lock.source_audit.entrypoints.push(structuredClone(c.lock.source_audit.entrypoints[0])) }, /duplicate audit/],
]
