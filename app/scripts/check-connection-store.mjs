#!/usr/bin/env node
// Connection identity is host + username. Password never lands in JS-readable storage.
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outfile = join(tmpdir(), `connection-store-check-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, "../src/lib/hermes-client.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { AuthError, ConnectionStore, HermesConnection } = await import(pathToFileURL(outfile).href);

class MemoryStorage {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

const STORE_KEY = "hermes-mobile.connections.v1";
const remembered = {
  id: "gw-1",
  label: "NUC",
  url: "https://gateway.example.invalid",
  username: "operator",
};

const storage = new MemoryStorage();
const store = new ConnectionStore(storage);
store.save({ ...remembered, password: "never-store-this" });
const persisted = JSON.parse(storage.getItem(STORE_KEY));
assert.deepEqual(persisted, [remembered]);
assert.equal(JSON.stringify(persisted).includes("never-store-this"), false);
assert.deepEqual(store.list(), [remembered]);
assert.equal(store.get("gw-1")?.username, "operator");
assert.equal("password" in (store.get("gw-1") ?? {}), false);

const legacy = new MemoryStorage({
  [STORE_KEY]: JSON.stringify([
    { ...remembered, password: "legacy-secret", token: "also-secret" },
    { id: "bad", username: "x" },
  ]),
});
const migrated = new ConnectionStore(legacy).list();
assert.deepEqual(migrated, [remembered]);
assert.equal(legacy.getItem(STORE_KEY).includes("legacy-secret"), false);
assert.equal(legacy.getItem(STORE_KEY).includes("also-secret"), false);
assert.deepEqual(JSON.parse(legacy.getItem(STORE_KEY)), [remembered]);

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/auth/password-login")) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "session=cookie-value; HttpOnly; Secure; SameSite=Lax",
      },
    });
  }
  if (String(url).endsWith("/api/auth/ws-ticket")) {
    const cookie = init.headers?.Cookie || init.headers?.cookie || "";
    if (!cookie.includes("session=cookie-value")) {
      return new Response(JSON.stringify({ error: "login required" }), { status: 401 });
    }
    return new Response(JSON.stringify({ ticket: "one-use" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("missing", { status: 404 });
};

const client = new HermesConnection({ url: remembered.url, username: remembered.username });
await assert.rejects(() => client.mintWsTicket(), (err) => err instanceof AuthError && err.status === 401);
assert.equal(calls.some((c) => c.url.endsWith("/auth/password-login")), false);
await client.login(remembered.username, "typed-password");
const login = calls.find((c) => c.url.endsWith("/auth/password-login"));
assert.deepEqual(JSON.parse(login.init.body), {
  provider: "basic",
  username: remembered.username,
  password: "typed-password",
});
assert.equal(storage.getItem(STORE_KEY).includes("typed-password"), false);
const ticket = await client.mintWsTicket();
assert.equal(ticket, "one-use");
const ticketCall = calls.at(-1);
assert.equal(ticketCall.init.headers.Cookie.includes("session=cookie-value"), true);
assert.equal(JSON.stringify(store.list()).includes("typed-password"), false);

console.log("connection store check: PASS (password never persisted; session continues from cookie)");
