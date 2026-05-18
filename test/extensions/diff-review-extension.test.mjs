import test from "node:test";
import assert from "node:assert/strict";

import { createReviewSessionStore } from "../../pi-extension/diff-review/state.ts";
import { recordReply } from "../../pi-extension/diff-review/reply-tool.ts";

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

function makeSessionSeed() {
	return {
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
		pendingSubmission: {
			id: "round-1",
			reviewSessionId: "review-session-1",
			threadIds: ["thread-1"],
		},
		files: [
			{ path: "src/a.ts" },
		],
		threads: [
			{
				id: "thread-1",
				path: "src/a.ts",
				root: {
					id: "comment-1",
					path: "src/a.ts",
					body: "Please review this change",
					status: "submitted",
					line: { startLine: 4, endLine: 6, targetSide: "new" },
				},
				replies: [],
			},
		],
	};
}

test("diff-review extension registers command and reply tool", async () => {
	const { default: diffReviewExtension } = await import("../../pi-extension/diff-review/index.ts");
	const pi = createFakePi();

	diffReviewExtension(pi);

	assert.ok(pi.commands.has("diff-review"));
	assert.ok(pi.tools.has("diff_review_reply"));
});

test("reply tool accepts thread target with path and optional line reference", async () => {
	const store = createReviewSessionStore();
	const session = store.create(makeSessionSeed());
	const result = await recordReply(store, {
		reviewSessionId: session.reviewSessionId,
		submissionRoundId: "round-1",
		threadId: "thread-1",
		path: "src/a.ts",
		line: { startLine: 4, endLine: 6, targetSide: "new" },
		reply: "Looks good",
	});
	assert.equal(result.path, "src/a.ts");
	assert.equal(result.line?.startLine, 4);
});

test("reply tool rejects malformed or unknown payloads", async () => {
	const store = createReviewSessionStore();
	const session = store.create(makeSessionSeed());
	await assert.rejects(() => recordReply(store, { reviewSessionId: "wrong", submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /review session/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "wrong", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /submission round/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", path: "src/a.ts", reply: "x" }), /threadId or commentId/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", commentId: "comment-1", path: "src/a.ts", reply: "x" }), /exactly one/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "missing", path: "src/a.ts", reply: "x" }), /thread/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", commentId: "missing", path: "src/a.ts", reply: "x" }), /comment/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", reply: "x" }), /path/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "" }), /reply/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", line: { startLine: 6, endLine: 4, targetSide: "new" }, reply: "x" }), /line/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/other.ts", reply: "x" }), /path/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", line: { startLine: 9, endLine: 10, targetSide: "new" }, reply: "x" }), /line/i);
});
