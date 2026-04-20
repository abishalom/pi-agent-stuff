import test from "node:test";
import assert from "node:assert/strict";
import { selectSourceText } from "../../pi-extension/answer/source-selection.ts";

function message(role, blocks, extra = {}) {
	return {
		type: "message",
		message: {
			role,
			content: blocks,
			...extra,
		},
	};
}

function ctxWithBranch(branch) {
	return {
		sessionManager: {
			getBranch() {
				return branch;
			},
		},
	};
}

test("last-assistant matches upstream behavior for latest complete assistant text", () => {
	const ctx = ctxWithBranch([
		message("user", [{ type: "text", text: "hello" }]),
		message("assistant", [{ type: "text", text: "older" }], { stopReason: "stop" }),
		message("assistant", [{ type: "image", url: "ignored" }], { stopReason: "stop" }),
		message("assistant", [{ type: "text", text: "newest" }, { type: "text", text: "question?" }], { stopReason: "stop" }),
	]);

	assert.equal(selectSourceText(ctx, "last-assistant"), "newest\nquestion?");
});

test("last-assistant errors on incomplete latest assistant message", () => {
	const ctx = ctxWithBranch([
		message("assistant", [{ type: "text", text: "done" }], { stopReason: "stop" }),
		message("assistant", [{ type: "text", text: "still streaming" }], { stopReason: "length" }),
	]);

	assert.throws(() => selectSourceText(ctx, "last-assistant"), /Last assistant message incomplete \(length\)/);
});

test("last-assistant errors when no assistant text exists", () => {
	const ctx = ctxWithBranch([message("user", [{ type: "text", text: "hello" }])]);
	assert.throws(() => selectSourceText(ctx, "last-assistant"), /No assistant messages found/);
});

test("last-user, last-turn, and whole-branch produce configurable alternative sources", () => {
	const ctx = ctxWithBranch([
		message("user", [{ type: "text", text: "First question" }]),
		message("assistant", [{ type: "text", text: "First answer" }], { stopReason: "stop" }),
		message("user", [{ type: "text", text: "Second question" }]),
		message("assistant", [{ type: "text", text: "Second answer" }], { stopReason: "stop" }),
	]);

	assert.equal(selectSourceText(ctx, "last-user"), "Second question");
	assert.equal(selectSourceText(ctx, "last-turn"), "User:\nSecond question\n\nAssistant:\nSecond answer");
	assert.equal(
		selectSourceText(ctx, "whole-branch"),
		"User:\nFirst question\n\nAssistant:\nFirst answer\n\nUser:\nSecond question\n\nAssistant:\nSecond answer",
	);
});
