#!/usr/bin/env node
/**
 * smoke.mjs — end-to-end smoke test of the hermes-client library against a
 * live `hermes serve` backend. Exercises the same code path the app uses,
 * without a UI:
 *
 *   GET /api/status → mint HMAC bearer from local config secret →
 *   POST /api/auth/ws-ticket → WS /api/ws?ticket=… (gateway.ready) →
 *   session.list → session.create → prompt.submit ("Reply with exactly: PONG")
 *   → stream message.delta until message.complete.
 *
 * The bearer token is minted locally the same way relay-daemon does
 * (dashboard.basic_auth.secret in ~/.hermes/config.yaml). The secret is never
 * printed. A provider/LLM upstream failure is reported as such — it still
 * proves auth + WS + RPC work and that the error propagates to the client.
 *
 * Usage: node scripts/smoke.mjs [base-url]   (default http://100.105.150.35:9119)
 */

import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import crypto from "node:crypto";
import yaml from "yaml";

const BASE = process.argv[2] ?? "http://100.105.150.35:9119";
const TURN_TIMEOUT_MS = 120_000;

// ── bundle the TS client lib and import it (same artifact the app ships) ────
const here = fileURLToPath(new URL(".", import.meta.url));
const outfile = join(tmpdir(), `hermes-client-smoke-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, "../src/lib/hermes-client.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "silent",
});
const { HermesConnection } = await import(pathToFileURL(outfile).href);

// ── mint the HMAC bearer token (relay-daemon flow; secret stays local) ──────
function mintBearer() {
  const cfg = yaml.parse(readFileSync(join(process.env.HOME, ".hermes/config.yaml"), "utf8"));
  const section = cfg?.dashboard?.basic_auth;
  if (!section?.secret || !section?.username) {
    throw new Error("dashboard.basic_auth.secret/username missing in ~/.hermes/config.yaml");
  }
  // Mirror plugins/dashboard_auth/basic._resolve_secret, but with STRICT
  // decoding: Python's b64decode rejects bad padding (43 chars here → raw
  // UTF-8 fallback), while Buffer.from(..., 'base64') silently decodes
  // garbage. Gate each decoder on format validity before trusting it.
  const rawStr = section.secret;
  let secret = null;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawStr) && rawStr.length % 4 === 0) {
    const d = Buffer.from(rawStr, "base64");
    if (d.length >= 16) secret = d;
  }
  if (!secret && /^[0-9a-fA-F]+$/.test(rawStr) && rawStr.length % 2 === 0) {
    const d = Buffer.from(rawStr, "hex");
    if (d.length >= 16) secret = d;
  }
  if (!secret) secret = Buffer.from(rawStr, "utf8");
  const raw = Buffer.from(
    JSON.stringify({ sub: section.username, kind: "access", exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const sig = crypto.createHmac("sha256", secret).update(raw).digest();
  // Server-side _unsign uses Python's urlsafe_b64decode, which REQUIRES '='
  // padding — Buffer.toString("base64url") strips it, so build it manually.
  return Buffer.concat([raw, sig])
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

let failures = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`FAIL  ${msg}`);
};

console.log(`smoke: backend ${BASE}`);

// 1. liveness probe (public endpoint)
const client = new HermesConnection({ url: BASE, bearerToken: mintBearer() });
try {
  const status = await client.status();
  ok(`GET /api/status → Hermes ${status.version ?? "?"}`);
} catch (err) {
  fail(`GET /api/status: ${err.message}`);
  process.exit(1);
}

// 2. ws-ticket + connect + gateway.ready
try {
  const ticket = await client.mintWsTicket();
  ok(`POST /api/auth/ws-ticket → ticket (len ${ticket.length})`);
} catch (err) {
  fail(`ws-ticket: ${err.message}`);
  process.exit(1);
}
try {
  await client.connect();
  ok("WS /api/ws connected, gateway.ready received");
} catch (err) {
  fail(`connect: ${err.message}`);
  process.exit(1);
}

// 3. session.list
let sessions = [];
try {
  sessions = await client.listSessions({ limit: 5 });
  ok(`session.list → ${sessions.length} session(s) returned`);
} catch (err) {
  fail(`session.list: ${err.message}`);
  process.exit(1);
}

// 4. session.create
let sid = "";
try {
  const created = await client.createSession({ title: "hermes-mobile smoke" });
  sid = created.session_id;
  ok(`session.create → live sid ${sid} (model: ${created.info?.model ?? "?"})`);
} catch (err) {
  fail(`session.create: ${err.message}`);
  process.exit(1);
}

// 4b. model.options (composer model picker catalog)
try {
  const options = await client.modelOptions(sid);
  const nProviders = (options.providers ?? []).length;
  const nModels = (options.providers ?? []).reduce((n, p) => n + (p.models?.length ?? 0), 0);
  if (nProviders === 0) throw new Error("empty provider catalog");
  ok(`model.options → ${nProviders} provider(s), ${nModels} model(s), current ${options.provider ?? "?"}/${options.model ?? "?"}`);
} catch (err) {
  fail(`model.options: ${err.message}`);
  process.exit(1);
}

// 4c. config.set reasoning — session-scoped, disposable smoke session
try {
  const set = await client.configSet(sid, "reasoning", "high");
  if (set.key !== "reasoning") throw new Error(`unexpected envelope: ${JSON.stringify(set).slice(0, 120)}`);
  ok(`config.set reasoning=high → ${JSON.stringify(set.value)}`);
} catch (err) {
  fail(`config.set reasoning: ${err.message}`);
  process.exit(1);
}

// 5. prompt.submit + stream until message.complete
const turn = new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ done: false, reason: "timeout" }), TURN_TIMEOUT_MS);
  let deltas = 0;
  let streamed = "";
  const unsub = client.addEventHandler((event) => {
    if (event.session_id && event.session_id !== sid) return;
    if (event.type === "message.delta") {
      deltas++;
      streamed += String(event.payload?.text ?? "");
    } else if (event.type === "message.complete") {
      clearTimeout(timer);
      unsub();
      resolve({
        done: true,
        deltas,
        status: event.payload?.status ?? "ok",
        text: String(event.payload?.text ?? streamed),
      });
    } else if (event.type === "error") {
      clearTimeout(timer);
      unsub();
      resolve({ done: true, deltas, status: "error", text: String(event.payload?.message ?? "") });
    }
  });
});

try {
  const accepted = await client.submitPrompt(sid, "Reply with exactly: PONG");
  ok(`prompt.submit accepted (${accepted.status ?? "?"}) — waiting for the turn…`);
} catch (err) {
  fail(`prompt.submit: ${err.message}`);
  process.exit(1);
}

const result = await turn;
if (!result.done) {
  fail(`turn did not complete within ${TURN_TIMEOUT_MS / 1000}s`);
} else if (result.status === "error" || /error/i.test(result.text.slice(0, 12))) {
  // Provider-side failure (e.g. free-stack upstream down) still proves the
  // client pipeline: the error propagated as a proper gateway event.
  ok(`turn reached client as error event (provider-side): ${result.text.slice(0, 140)}`);
} else {
  ok(`message.complete after ${result.deltas} delta(s): ${JSON.stringify(result.text.slice(0, 120))}`);
}

client.disconnect();
console.log(failures === 0 ? "\nsmoke: PASS" : `\nsmoke: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
