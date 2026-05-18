import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };

function assertScriptIsNotSuccessPlaceholder(name) {
	const script = packageJson.scripts[name];
	assert.equal(typeof script, "string");
	const isPlaceholder = script.includes("not implemented yet");
	const failsFast = script.includes("process.exit(1)") || script.includes("throw new Error");
	assert.ok(!isPlaceholder || failsFast, `${name} must fail fast until implemented`);
}

test("package manifest loads local diff-review extension instead of upstream package", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/diff-review/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-diff-review/src/index.ts"));
	assertScriptIsNotSuccessPlaceholder("build:diff-review-web");
	assertScriptIsNotSuccessPlaceholder("verify:diff-review-web");
});
