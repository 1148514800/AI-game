import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = "release/client";
const sentinel = Buffer.from("phase2-build-dummy-key-do-not-expose");
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));
assert.ok(
  files.some((file) => file.endsWith(".js")),
  "No client JavaScript in release/client",
);
for (const file of files)
  assert.ok(
    !readFileSync(file).includes(sentinel),
    `Dummy key exposed in ${file}`,
  );
console.log(
  `Dummy key absent from all ${files.length} generated client files.`,
);
