import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
test("offline build is self-contained and its combined script compiles", async () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL("../scripts/build-download.js", import.meta.url)),
  ]);
  const html = await readFile(
    new URL("../dist/Settlement-Planner-UK.html", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Script(source);
  assert.doesNotMatch(source, /^(import|export) /m);
  assert.ok(html.includes("Export JSON backup"));
  assert.ok(html.includes("Supabase") === false);
});

test("recovery controls exist in the page and the standalone preview compiles", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const ids = [...html.matchAll(/id="([^\"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, "duplicate IDs");
  const controller = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  for (const [, id] of controller.matchAll(/\$\("([^\"]+)"\)/g))
    assert.ok(ids.includes(id), "Missing controller target: " + id);
  execFileSync(process.execPath, [
    fileURLToPath(new URL("../scripts/build-preview.js", import.meta.url)),
  ]);
  const preview = await readFile(
    new URL("../dist/Settlement-Planner-UK-Preview.html", import.meta.url),
    "utf8",
  );
  const source = preview.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  new Script("(async()=>{" + source + "})()");
});
