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
