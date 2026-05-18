import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };

test("package manifest loads local diff-review extension instead of upstream package", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/diff-review/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-diff-review/src/index.ts"));
});
