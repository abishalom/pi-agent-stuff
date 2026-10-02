import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };

// The loader is not a top-level SDK export. Resolve it relative to the installed
// host entry point rather than relying on a particular node_modules layout.
const hostEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", hostEntry).href);
const repo = fileURLToPath(new URL("../../", import.meta.url));

test("Pi 1.0.0 loader registers every manifest extension without errors", async () => {
	const paths = packageJson.pi.extensions.map((entry) => path.resolve(repo, entry));
	const result = await loadExtensions(paths, repo);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, paths.length);
	assert.equal(new Set(result.extensions.map((extension) => extension.path)).size, paths.length);
});
