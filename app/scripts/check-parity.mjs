#!/usr/bin/env node
/** Offline HM-UX-01 schema/source-lock gate. Node standard library only; no network. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REPOSITORY = 'https://github.com/NousResearch/hermes-agent'
export const ROUTE_IDS = 'home chats chat bots bot groups group activity approval schedules schedule manage gateways profiles capabilities memory messaging webhooks kanban command-center files preview artifacts git terminal browser settings voice native'.split(' ')
const STATUS = ['unverified', 'missing', 'partial', 'implemented-unproven', 'verified', 'blocked']
const ENUMS = {
  family: 'sessions scheduling profiles capabilities messaging webhooks memory operations settings local-models voice files git terminal chat approvals navigation bots groups kanban appearance artifacts browser connections native bundled'.split(' '),
  scope: 'gateway-profile gateway-profile-session gateway-profile-project gateway-profile-group gateway-board device device-session host-os external-account'.split(' '),
  release_status: ['unverified', 'in-stable', 'post-release'],
  current_status: STATUS,
  target_status: STATUS,
  platform_disposition: ['direct-web', 'mobile-equivalent-proposed', 'bridge-required', 'native-only'],
}
const REQUIRED = 'id title family desktop_source_sha desktop_source_path desktop_symbol desktop_source_url docs_url release_status scope desktop_transport gateway_contract mobile_route current_status target_status authority browser_constraints acceptance_test_ids evidence blocker platform_disposition'.split(' ')
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const text = x => typeof x === 'string' && x.trim().length > 0
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x)
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
const strings = x => Array.isArray(x) && x.every(text)
// eslint-disable-next-line no-control-regex -- Reject ASCII control characters in source paths intentionally.
const safePath = x => text(x) && !isAbsolute(x) && !x.includes('\\') && !x.split('/').some(p => ['', '.', '..'].includes(p)) && !/[?#\x00-\x1f]/.test(x)
const testId = x => typeof x === 'string' && /^(planned|executed):HM-UX-01:[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(x)

export function embeddedRoutes() {
  // Labels/entries here are schema fixtures, not proof that a prototype exists.
  return { schema_version: 1, routes: ROUTE_IDS.map(id => ({ id, title: id, kind: 'contract' })), variants: [
    { id: 'shell', entry: 'design/parity-shell/index.html', root: 'home' },
    { id: 'workspace', entry: 'design/parity-workspace/index.html', root: 'home' },
  ] }
}

/** Returns diagnostics rather than throwing on malformed JSON values. Evidence IO is read-only. */
export function validate({ inventory, lock, routes = embeddedRoutes() }, { root = ROOT } = {}) {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const enumValue = (value, values, label) => check(values.includes(value), `${label}: invalid enum ${JSON.stringify(value)}`)
  const unique = (values, label) => check(new Set(values).size === values.length, `duplicate ${label}`)
  if (!object(inventory) || !object(lock) || !object(routes)) return ['inventory, lock and routes must be objects']
  check(inventory.schema_version === 1, 'inventory schema_version must be 1')
  check(lock.schema_version === 1, 'lock schema_version must be 1')
  check(lock.repository === REPOSITORY, 'lock repository must be official upstream')
  check(sha(lock.main?.sha), 'main source pin must be full lowercase SHA')
  check(sha(lock.stable?.sha), 'stable source pin must be full lowercase SHA')
  check(lock.main?.source_url === `${REPOSITORY}/tree/${lock.main?.sha}`, 'main source URL must match pin')
  check(lock.stable?.source_url === `${REPOSITORY}/tree/${lock.stable?.sha}`, 'stable source URL must match pin')
  check(text(lock.stable?.tag), 'stable tag required')
  check(lock.stable?.release_url === `${REPOSITORY}/releases/tag/${lock.stable?.tag}`, 'stable release URL mismatch')
  const base = inventory.baseline
  check(object(base), 'baseline object required')
  check(base?.desktop_main_sha === lock.main?.sha && sha(base?.desktop_main_sha), 'main baseline must match source pin')
  check(base?.stable_sha === lock.stable?.sha && sha(base?.stable_sha), 'stable baseline must match source pin')
  check(base?.stable_release === lock.stable?.tag, 'stable release baseline mismatch')
  check(base?.upstream_lock === 'upstream-lock.json', 'baseline upstream_lock must be upstream-lock.json')
  check(typeof base?.mobile_commit === 'string' && /^[a-f0-9]{7,40}$/.test(base.mobile_commit), 'mobile baseline commit required')
  check(text(base?.route_contract) && text(base?.acceptance_test_policy), 'baseline route/test policy required')
  check(typeof inventory.inventory_complete === 'boolean', 'inventory_complete must be boolean')
  // This milestone has no reviewed release-diff receipt schema. Never accept a silent promotion.
  check(lock.release_comparison?.status === 'unverified', 'release comparison: reviewed diff support not implemented; remain unverified')
  check(lock.release_comparison?.minimum_backend_version === null, 'release comparison: backend minimum remains unknown')

  const sourceMap = new Map()
  check(Array.isArray(lock.sources) && lock.sources.length > 0, 'audited sources required')
  for (const source of Array.isArray(lock.sources) ? lock.sources : []) {
    if (!object(source)) { errors.push('audited source must be object'); continue }
    check(!sourceMap.has(source.path), `duplicate audited source ${source.path}`)
    sourceMap.set(source.path, source)
    check(source.sha === lock.main?.sha && sha(source.sha), `audited source pin: ${source.path}`)
    check(safePath(source.path), `audited source path: ${source.path}`)
    check(source.source_url === `${REPOSITORY}/blob/${source.sha}/${source.path}`, `audited source URL: ${source.path}`)
    check(digest(source.content_sha256), `audited source content hash: ${source.path}`)
    check(Array.isArray(source.symbols) && source.symbols.length > 0, `audited symbols required: ${source.path}`)
    const symbols = Array.isArray(source.symbols) ? source.symbols : []
    unique(symbols.map(s => s?.name), `audited symbol in ${source.path}`)
    for (const symbol of symbols) check(text(symbol?.name) && Number.isInteger(symbol?.line) && symbol.line > 0, `audited symbol location: ${source.path}`)
  }
  function sourceRef(ref, label) {
    if (!object(ref)) { errors.push(`${label}: source reference required`); return }
    check(sha(ref.sha) && ref.sha === lock.main?.sha, `${label}: source pin mismatch`)
    const source = sourceMap.get(ref.path)
    check(Boolean(source) && safePath(ref.path), `${label}: missing audited source path`)
    const symbol = Array.isArray(source?.symbols) ? source.symbols.find(s => s?.name === ref.symbol) : undefined
    check(Boolean(symbol), `${label}: missing audited symbol`)
    check(Boolean(symbol) && ref.url === `${REPOSITORY}/blob/${ref.sha}/${ref.path}#L${symbol.line}`, `${label}: source URL must match audited pin/path/line`)
  }
  const audit = lock.source_audit
  check(object(audit) && text(audit.method) && audit.tree_truncated === false, 'source audit must record method and nontruncated tree')
  const entries = Array.isArray(audit?.entrypoints) ? audit.entrypoints : []
  check(entries.length > 0, 'source audit entrypoints required')
  unique(entries.map(e => e?.id), 'audit id')
  for (const entry of entries) {
    check(text(entry?.id) && typeof entry?.enumeration_closed === 'boolean', 'audit id and enumeration_closed required')
    sourceRef(entry?.source, `audit ${entry?.id}`)
    check(strings(entry?.enumerated_entries), `audit ${entry?.id}: enumerated_entries required`)
    if (strings(entry?.enumerated_entries)) unique(entry.enumerated_entries, `enumerated entry in ${entry.id}`)
    check(strings(entry?.remaining), `audit ${entry?.id}: remaining required`)
    if (entry?.enumeration_closed) check(entry.remaining?.length === 0, `audit ${entry.id}: closed with remaining entries`)
    else check(entry?.remaining?.length > 0, `audit ${entry?.id}: unclosed enumeration reason required`)
  }
  const open = Array.isArray(audit?.open_enumeration) ? audit.open_enumeration : []
  check(Array.isArray(audit?.open_enumeration), 'open_enumeration array required')
  unique(open.map(e => e?.id), 'open enumeration id')
  for (const item of open) {
    check(text(item?.id) && text(item?.detail) && strings(item?.entrypoints), 'open enumeration record requires id/detail/entrypoints')
    if (strings(item?.entrypoints)) for (const id of item.entrypoints) check(entries.some(e => e?.id === id), `open enumeration unknown entrypoint ${id}`)
  }
  if (inventory.inventory_complete) {
    check(open.length === 0 && entries.every(e => e?.enumeration_closed), 'inventory_complete contradicts unclosed enumeration')
    // Closing lists alone is not a human source-coverage review.
    check(false, 'inventory_complete requires a reviewed full-enumeration gate; this bounded milestone does not implement it')
  }
  check(text(lock.scope?.included) && Array.isArray(lock.scope?.excluded), 'scope inclusion/exclusion records required')
  for (const exclusion of Array.isArray(lock.scope?.excluded) ? lock.scope.excluded : []) {
    check(text(exclusion?.id) && text(exclusion?.reason), 'exclusion id/reason required')
    sourceRef(exclusion?.source, 'exclusion')
  }

  check(routes.schema_version === 1, 'route schema_version must be 1')
  check(Array.isArray(routes.routes) && routes.routes.length > 0, 'route list required')
  const routeRows = Array.isArray(routes.routes) ? routes.routes : []
  const routeIds = routeRows.map(r => r?.id)
  unique(routeIds, 'route id')
  for (const r of routeRows) check(ROUTE_IDS.includes(r?.id) && text(r?.title) && text(r?.kind), `route id/title/kind invalid: ${r?.id}`)
  const variants = Array.isArray(routes.variants) ? routes.variants : []
  check(variants.length === 2 && variants.some(v => v?.id === 'shell') && variants.some(v => v?.id === 'workspace'), 'route variants must contain shell and workspace')
  unique(variants.map(v => v?.id), 'variant id')
  for (const v of variants) {
    check(routeIds.includes(v?.root), `variant root is not a route: ${v?.id}`)
    check(safePath(v?.entry) && v.entry.endsWith('.html'), `variant entry must be relative HTML path: ${v?.id}`)
  }

  function evidenceReceipt(receipt, f) {
    if (!object(receipt)) { errors.push(`${f.id}: evidence object required`); return }
    check(f.acceptance_test_ids?.includes(receipt.test_id) && receipt.test_id?.startsWith('executed:'), `${f.id}: evidence test reference must be executed acceptance id`)
    enumValue(receipt.result, ['pass', 'fail'], `${f.id}: evidence result`)
    check(text(receipt.command) && text(receipt.environment) && sha(receipt.mobile_source_sha), `${f.id}: evidence command/environment/mobile SHA required`)
    check(typeof receipt.executed_at === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(receipt.executed_at) && Number.isFinite(Date.parse(receipt.executed_at)), `${f.id}: evidence execution timestamp required`)
    check(digest(receipt.sha256), `${f.id}: evidence artifact hash required`)
    if (!safePath(receipt.artifact) || !receipt.artifact.startsWith('docs/parity/evidence/')) {
      errors.push(`${f.id}: evidence artifact must be under docs/parity/evidence/`)
      return
    }
    try {
      const file = realpathSync(resolve(root, receipt.artifact))
      const evidenceRoot = realpathSync(resolve(root, 'docs/parity/evidence'))
      const rel = relative(evidenceRoot, file)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('outside evidence directory')
      const bytes = readFileSync(file)
      check(bytes.length > 0 && createHash('sha256').update(bytes).digest('hex') === receipt.sha256, `${f.id}: evidence artifact bytes/hash mismatch`)
    } catch (error) { errors.push(`${f.id}: evidence artifact unreadable: ${error.message}`) }
  }

  check(Array.isArray(inventory.features) && inventory.features.length > 0, 'features must be nonempty array')
  const rows = Array.isArray(inventory.features) ? inventory.features : []
  unique(rows.map(f => f?.id), 'feature id')
  for (const f of rows) {
    if (!object(f)) { errors.push('feature object required'); continue }
    for (const key of REQUIRED) check(Object.hasOwn(f, key), `${f.id}: missing ${key}`)
    check(typeof f.id === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(f.id), 'invalid feature id')
    check(text(f.title), `${f.id}: title required`)
    for (const [key, values] of Object.entries(ENUMS)) enumValue(f[key], values, `${f.id}: ${key}`)
    sourceRef({ sha: f.desktop_source_sha, path: f.desktop_source_path, symbol: f.desktop_symbol, url: f.desktop_source_url }, f.id)
    check(typeof f.docs_url === 'string' && /^https:\/\/hermes-agent\.nousresearch\.com\/docs\/[^\s]+$/.test(f.docs_url), `${f.id}: official docs_url required`)
    if (f.release_status !== 'unverified') check(lock.release_comparison?.status !== 'unverified', `${f.id}: release comparison not performed`)
    enumValue(f.desktop_transport?.kind, ['json-rpc', 'rest-via-electron', 'electron-ipc', 'client-local', 'mixed'], `${f.id}: desktop_transport`)
    check(text(f.desktop_transport?.detail), `${f.id}: desktop_transport detail required`)
    const contract = f.gateway_contract
    enumValue(contract?.status, ['unknown', 'client-call-traced', 'handler-traced', 'not-applicable'], `${f.id}: gateway_contract`)
    check(text(contract?.detail), `${f.id}: gateway_contract detail required`)
    check(Array.isArray(contract?.sources), `${f.id}: gateway_contract.sources must be array`)
    if (['client-call-traced', 'handler-traced'].includes(contract?.status)) {
      check(text(contract.endpoint), `${f.id}: gateway_contract endpoint required`)
      enumValue(contract.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'RPC'], `${f.id}: gateway_contract method`)
      check(contract.method === 'RPC' ? /^[a-z]+\.[a-z_]+$/.test(contract.endpoint ?? '') : /^\/api\/[A-Za-z0-9_/{}/.-]+$/.test(contract.endpoint ?? ''), `${f.id}: gateway_contract endpoint format`)
    }
    if (contract?.status === 'handler-traced') check(Array.isArray(contract.sources) && contract.sources.length > 0, `${f.id}: handler-traced requires source`)
    for (const ref of Array.isArray(contract?.sources) ? contract.sources : []) sourceRef(ref, `${f.id}: gateway handler`)
    check(routeIds.includes(f.mobile_route), `${f.id}: mobile_route missing from route contract`)
    enumValue(f.authority?.owner, ['server', 'device', 'mixed', 'external-service'], `${f.id}: authority owner`)
    enumValue(f.authority?.mutation, ['none', 'client-state', 'server-state', 'privileged', 'external-effect'], `${f.id}: authority mutation`)
    enumValue(f.authority?.gate, ['read-only', 'user-action', 'confirm-target', 'owner-approval'], `${f.id}: authority gate`)
    check(strings(f.browser_constraints) && f.browser_constraints.length > 0, `${f.id}: browser_constraints required`)
    check(Array.isArray(f.acceptance_test_ids) && f.acceptance_test_ids.length > 0 && f.acceptance_test_ids.every(testId), `${f.id}: acceptance_test_ids require planned:/executed: HM-UX-01 ids`)
    if (Array.isArray(f.acceptance_test_ids)) unique(f.acceptance_test_ids, `acceptance_test_ids in ${f.id}`)
    check(Array.isArray(f.evidence), `${f.id}: evidence must be array`)
    for (const receipt of Array.isArray(f.evidence) ? f.evidence : []) evidenceReceipt(receipt, f)
    for (const id of Array.isArray(f.acceptance_test_ids) ? f.acceptance_test_ids : []) {
      if (typeof id === 'string' && id.startsWith('executed:')) check(Array.isArray(f.evidence) && f.evidence.some(e => e?.test_id === id), `${f.id}: executed acceptance_test_ids require evidence receipt`)
    }
    check(typeof f.blocker === 'string' || f.blocker === null, `${f.id}: blocker must be string or null`)
    if (f.current_status !== 'verified') check(text(f.blocker), `${f.id}: unresolved status requires blocker`)
    if (f.current_status === 'verified') {
      check(Array.isArray(f.evidence) && f.evidence.length > 0, `${f.id}: verified requires real passing evidence`)
      check(Array.isArray(f.acceptance_test_ids) && Array.isArray(f.evidence) && f.acceptance_test_ids.every(id => typeof id === 'string' && id.startsWith('executed:') && f.evidence.some(e => e?.test_id === id && e.result === 'pass')), `${f.id}: verified requires passing evidence for every executed test, not planned tests`)
      check(f.blocker === null, `${f.id}: verified cannot retain blocker`)
    }
  }
  return errors
}

export function summarize(inventory, lock, routes, routeMode) {
  const rows = inventory.features
  const countBy = key => Object.fromEntries([...new Set(rows.map(f => f[key]))].sort().map(value => [value, rows.filter(f => f[key] === value).length]))
  return {
    inventory_rows: rows.length,
    inventory_complete: inventory.inventory_complete,
    audited_entrypoints: lock.source_audit.entrypoints.length,
    closed_registration_lists: lock.source_audit.entrypoints.filter(e => e.enumeration_closed).length,
    unclosed_entrypoints: lock.source_audit.entrypoints.filter(e => !e.enumeration_closed).length,
    open_enumeration_work_items: lock.source_audit.open_enumeration.length,
    pinned_source_files: lock.sources.length,
    current_status: countBy('current_status'),
    platform_disposition: countBy('platform_disposition'),
    release_status: countBy('release_status'),
    gateway_contract: Object.fromEntries(['unknown', 'client-call-traced', 'handler-traced', 'not-applicable'].map(status => [status, rows.filter(f => f.gateway_contract.status === status).length])),
    functional_parity_verified_rows: rows.filter(f => f.current_status === 'verified').length,
    blocked_rows: rows.filter(f => f.current_status === 'blocked').length,
    native_or_bridge_disposition_rows: rows.filter(f => ['native-only', 'bridge-required'].includes(f.platform_disposition)).length,
    evidence_receipts: rows.reduce((sum, f) => sum + f.evidence.length, 0),
    planned_test_references: rows.reduce((sum, f) => sum + f.acceptance_test_ids.filter(id => id.startsWith('planned:')).length, 0),
    mapped_route_ids: new Set(rows.map(f => f.mobile_route)).size,
    route_contract_ids: routes.routes.length,
    route_mode: routeMode,
    release_ready: false,
    interpretation: 'Counts describe inventoried rows only, not all Desktop actions or full feature completeness. Structural validation is not runtime parity or release evidence.',
  }
}

async function main(args) {
  let routesPath = null
  let selfTest = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--self-test') selfTest = true
    else if (args[i] === '--routes' && args[i + 1] && !args[i + 1].startsWith('--')) routesPath = resolve(args[++i])
    else throw new Error(`Unknown/incomplete option: ${args[i]}. Usage: node app/scripts/check-parity.mjs [--routes path.json] [--self-test]`)
  }
  const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
  const candidate = {
    inventory: readJson(resolve(ROOT, 'docs/parity/features.json')),
    lock: readJson(resolve(ROOT, 'docs/parity/upstream-lock.json')),
    routes: routesPath ? readJson(routesPath) : embeddedRoutes(),
  }
  const errors = validate(candidate)
  if (errors.length) throw new Error(`Parity validation failed (${errors.length}):\n${errors.join('\n')}`)
  console.log('PASS parity inventory validation')
  console.log(JSON.stringify(summarize(candidate.inventory, candidate.lock, candidate.routes, routesPath ? 'actual-json' : 'embedded-contract'), null, 2))
  if (selfTest) {
    const { negativeFixtures } = await import('./parity-negative-fixtures.mjs')
    // Use the agreed complete route contract for mutation fixtures so tests are deterministic.
    const seed = { ...candidate, routes: embeddedRoutes() }
    assert.deepEqual(validate(seed), [], 'unchanged positive inventory')
    for (const [name, mutate, expected] of negativeFixtures) {
      const changed = structuredClone(seed)
      mutate(changed)
      assert.match(validate(changed).join('\n'), expected, `negative fixture was not rejected for the expected reason: ${name}`)
    }
    console.log(`PASS self-test: 1 unchanged positive fixture; ${negativeFixtures.length} mutated negative fixtures rejected`)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
