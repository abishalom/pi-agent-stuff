import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };

function assertImplementedScript(name) {
	const script = packageJson.scripts[name];
	assert.equal(typeof script, "string");
	assert.ok(!script.includes("not implemented yet"), `${name} must be implemented`);
}

test("package manifest loads local diff-review extension instead of upstream package", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/diff-review/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-diff-review/src/index.ts"));
	assertImplementedScript("build:diff-review-web");
	assertImplementedScript("verify:diff-review-web");
});
