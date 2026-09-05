#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outfile = join(tmpdir(), `chat-resume-check-${process.pid}.mjs`);
const clientOutfile = join(tmpdir(), `chat-client-check-${process.pid}.mjs`);
const activeOutfile = join(tmpdir(), `active-session-check-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, "../src/screens/chat-resume-utils.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
buildSync({
  entryPoints: [join(here, "../src/lib/hermes-client.ts")],
  outfile: clientOutfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
buildSync({
  entryPoints: [join(here, "../src/lib/active-sessions.ts")],
  outfile: activeOutfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const {
  acceptLiveEvent,
  allowSmoothAutoScroll,
  freshHistoryMessages,
  liveTurnEvents,
  preservedScrollTop,
  resumeCatchupEvents,
  resumeTurnEvents,
  shouldFetchSessionHistory,
} = await import(pathToFileURL(outfile).href);
const { HermesConnection } = await import(pathToFileURL(clientOutfile).href);
const { getSessionEvents, recordSessionEvent } = await import(pathToFileURL(activeOutfile).href);
const event = (type) => ({ type, session_id: "s", payload: {} });

assert.deepEqual(
  liveTurnEvents([event("message.start"), event("message.delta")]).map((item) => item.type),
  ["message.start", "message.delta"],
);
assert.deepEqual(
  liveTurnEvents([
    event("message.start"), event("message.complete"),
    event("message.start"), event("tool.start"),
  ]).map((item) => item.type),
  ["message.start", "tool.start"],
);
assert.deepEqual(
  liveTurnEvents([event("message.start"), event("error")]),
  [],
);
assert.deepEqual(
  resumeTurnEvents([event("message.start"), event("message.delta"), event("tool.start")], false),
  [],
  "settled gateway state must never replay stale cached streaming events",
);
assert.deepEqual(
  resumeTurnEvents([event("message.start"), event("tool.start")], true).map((item) => item.type),
  ["message.start", "tool.start"],
  "running gateway state may restore current thinking/tool state",
);
const baselineStart = event("message.start");
const racedStart = event("message.start");
assert.deepEqual(
  resumeCatchupEvents([baselineStart], [baselineStart, racedStart], false),
  [racedStart],
  "a turn starting during idle resume history fetch must survive catch-up exactly once",
);
assert.deepEqual(
  resumeCatchupEvents([baselineStart], [baselineStart], false),
  [],
  "stale baseline events must stay discarded when resume reports idle",
);
assert.equal(acceptLiveEvent(true), false, "events racing initial catch-up must not animate");
assert.equal(acceptLiveEvent(false), true, "events after catch-up remain live");
assert.equal(
  allowSmoothAutoScroll(false, true, true, false),
  false,
  "history growth before the initial snap must not smooth-scroll",
);
assert.equal(
  allowSmoothAutoScroll(false, false, true, false),
  true,
  "later live growth may smooth-scroll",
);
assert.equal(
  preservedScrollTop(900, 250, 1300),
  650,
  "prepending older rows must preserve the visible viewport",
);
const loadedKeys = new Set(["3", "4"]);
assert.deepEqual(
  freshHistoryMessages([{ id: 1 }, { id: 2 }, { id: 3 }], loadedKeys),
  [{ id: 1 }, { id: 2 }],
  "latest-offset overlap must not duplicate already rendered messages",
);
assert.deepEqual([...loadedKeys].sort(), ["1", "2", "3", "4"]);
assert.equal(
  shouldFetchSessionHistory(true, "20260905_211203_b1b78b", true),
  false,
  "fresh profile Bot Chat drafts must not hit REST before their first prompt persists state.db",
);
assert.equal(
  shouldFetchSessionHistory(true, "20260905_211203_b1b78b", false),
  true,
  "persisted profile sessions must keep fail-closed REST history loading",
);

const cacheOwner = {};
recordSessionEvent(cacheOwner, { type: "message.start", session_id: "s", payload: {} }, 1);
recordSessionEvent(cacheOwner, { type: "message.delta", session_id: "s", payload: { text: "A" } }, 1);
const cachedDelta = getSessionEvents(cacheOwner, "s", 1).at(-1);
recordSessionEvent(cacheOwner, { type: "message.delta", session_id: "s", payload: { text: "B" } }, 1);
const latestDelta = getSessionEvents(cacheOwner, "s", 1).at(-1);
assert.equal(latestDelta, cachedDelta, "coalesced deltas must retain object identity");
assert.equal(latestDelta.payload.text, "AB");

const originalFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, init) => {
  request = { url: String(url), init };
  return new Response(JSON.stringify({
    session_id: "stored/id",
    messages: [{ role: "user", content: "older" }],
    pagination: { limit: 50, offset: 100, order: "latest", returned: 1 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
  const client = new HermesConnection({ url: "https://gateway.test/", bearerToken: "secret" });
  const page = await client.sessionMessages("stored/id", {
    limit: 120,
    offset: 120,
    order: "latest",
    includeCompacted: true,
    profile: "work profile",
  });
  assert.equal(page.messages[0].content, "older");
  assert.equal(
    request.url,
    "https://gateway.test/api/sessions/stored%2Fid/messages?limit=120&offset=120&order=latest&include_compacted=true&profile=work+profile",
  );
  assert.equal(request.init.credentials, "include");
  assert.equal(request.init.headers.Authorization, "Bearer secret");

  const rpcCalls = [];
  client.rpc = async (method, params) => {
    rpcCalls.push({ method, params });
    return method === "session.resume"
      ? { session_id: "runtime", messages: [], message_count: 240 }
      : { status: "queued", text: params.text };
  };
  await client.resumeSession("stored", { omitMessages: true });
  await client.resumeSession("bot-stored", { omitMessages: true, profile: "builder" });
  await client.steerSession("runtime", "focus on tests");
  await client.interruptSession("runtime");
  assert.deepEqual(rpcCalls, [
    { method: "session.resume", params: { session_id: "stored", omit_messages: true } },
    {
      method: "session.resume",
      params: { session_id: "bot-stored", omit_messages: true, profile: "builder" },
    },
    { method: "session.steer", params: { session_id: "runtime", text: "focus on tests" } },
    { method: "session.interrupt", params: { session_id: "runtime" } },
  ]);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("chat resume check: PASS");
