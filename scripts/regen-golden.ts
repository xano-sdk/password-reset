/**
 * Rewrite `test/fixtures/golden-bundle.json` from the current source.
 *
 * Regenerating the fixture is a DELIBERATE, REVIEWED act - never a way to make
 * a red test go green. A failing golden test means the encoded bundle moved:
 * find out WHY first. Then run this and read the diff line by line - guids,
 * auth flags, stack order, output lists.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDEN_FIXTURE_URL, buildGoldenBundle, serializeGoldenBundle } from "../test/golden.js";

// The directory does not exist on a freshly scaffolded module, and the first
// run of this script is what creates the fixture in the first place.
mkdirSync(dirname(fileURLToPath(GOLDEN_FIXTURE_URL)), { recursive: true });
writeFileSync(GOLDEN_FIXTURE_URL, serializeGoldenBundle(buildGoldenBundle()), "utf8");

console.log("Wrote test/fixtures/golden-bundle.json for @xano-sdk/password-reset.");
console.log("Review the diff line by line before committing: guids, auth flags, stack order, output lists.");
