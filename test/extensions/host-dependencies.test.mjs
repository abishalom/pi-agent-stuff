import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };

// Pi maps these imports to its own runtime modules when loading extensions.
const hostPackages = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
];

test("Pi development packages target the current 1.0.0 API", () => {
	for (const name of hostPackages.filter((name) => name !== "typebox" && name !== "@earendil-works/pi-agent-core")) {
		assert.equal(packageJson.devDependencies[name], "^1.0.0");
	}
	for (const field of ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"]) {
		assert.ok(!Object.keys(packageJson[field] ?? {}).some((name) => name.startsWith("@mariozechner/")));
	}
	assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
});

for (const name of hostPackages) {
	test(`${name} follows Pi's host-provided dependency contract`, () => {
		assert.equal(packageJson.dependencies?.[name], undefined);
		assert.equal(packageJson.optionalDependencies?.[name], undefined);
		const bundled = packageJson.bundleDependencies ?? packageJson.bundledDependencies;
		assert.notEqual(bundled, true);
		if (Array.isArray(bundled)) assert.ok(!bundled.includes(name));
		if (name in (packageJson.peerDependencies ?? {}) || name in (packageJson.devDependencies ?? {})) {
			assert.equal(packageJson.peerDependencies?.[name], "*");
		}
	});
}
