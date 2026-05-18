import test from "node:test";
import assert from "node:assert/strict";

function createFakePi() {
	const commands = new Map();
	const tools = new Map();

	return {
		commands,
		tools,
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerTool(definition) {
			tools.set(definition.name, definition);
		},
	};
}

test("diff-review extension registers command and reply tool", async () => {
	const { default: diffReviewExtension } = await import("../../pi-extension/diff-review/index.ts");
	const pi = createFakePi();

	diffReviewExtension(pi);

	assert.ok(pi.commands.has("diff-review"));
	assert.ok(pi.tools.has("diff_review_reply"));
});
