#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outfile = join(tmpdir(), `chat-resume-check-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, "../src/screens/chat-resume-utils.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { liveTurnEvents } = await import(pathToFileURL(outfile).href);
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
console.log("chat resume check: PASS");
