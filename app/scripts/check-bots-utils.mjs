#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outfile = join(tmpdir(), `bots-utils-check-${process.pid}.mjs`);
buildSync({
  entryPoints: [join(here, "../src/screens/bots-utils.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { botPreview, botTitle } = await import(pathToFileURL(outfile).href);

assert.equal(botTitle({ name: "default" }), "Hermes");
assert.equal(botTitle({ name: "build_agent" }), "Build Agent");
assert.equal(
  botTitle({ name: "lab", display_name: "Research Lab", ui_meta: { "hermes-bots": { title: "Lab Bot" } } }),
  "Lab Bot",
);
assert.equal(
  botPreview({
    name: "lab",
    canonical_session: { id: "1", preview: "**Done** with `tests`" },
    last_session: { id: "2", preview: "stale" },
  }),
  "Done with tests",
);

console.log("bots utils check: PASS");
