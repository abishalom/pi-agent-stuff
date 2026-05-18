import test from "node:test";
import assert from "node:assert/strict";

import {
	completeSubmissionRound,
	createReviewSessionStore,
	submitReview,
} from "../../pi-extension/diff-review/state.ts";
import { recordReply } from "../../pi-extension/diff-review/reply-tool.ts";

function makeSessionWithOpenThread() {
	const store = createReviewSessionStore();
	return store.create({
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
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
					status: "open",
					line: { startLine: 4, endLine: 6, targetSide: "new" },
				},
				replies: [],
			},
		],
	});
}

test("review sessions are keyed by pi session key and repo root", () => {
	const store = createReviewSessionStore();
	const a = store.create({ piSessionKey: "s1", repoRoot: "/repo-a" });
	const b = store.create({ piSessionKey: "s1", repoRoot: "/repo-b" });
	assert.notEqual(a.reviewSessionId, b.reviewSessionId);
});


test("generated review session ids do not collide with seeded explicit ids", () => {
	const store = createReviewSessionStore();
	const seeded = store.create({
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		reviewSessionId: "review-session-1",
	});
	const generated = store.create({ piSessionKey: "s1", repoRoot: "/repo-b" });

	assert.notEqual(generated.reviewSessionId, seeded.reviewSessionId);
	assert.equal(store.getById(seeded.reviewSessionId), seeded);
});

test("submit state is atomic when Pi injection fails", async () => {
	const session = makeSessionWithOpenThread();
	const failingInject = async () => {
		throw new Error("inject failed");
	};

	await assert.rejects(() => submitReview(session, failingInject), /inject failed/);
	assert.equal(session.pendingSubmission, null);
	assert.equal(session.threads[0].root.status, "open");
});

test("submitReview injects the synthesized prompt contract", async () => {
	const session = makeSessionWithOpenThread();
	let injectedPrompt = null;
	let injectedRound = null;

	await submitReview(session, async (prompt, round) => {
		injectedPrompt = prompt;
		injectedRound = round;
	});

	assert.equal(typeof injectedPrompt, "string");
	assert.ok(injectedPrompt.length > 0);
	assert.match(injectedPrompt, /reviewSessionId:\s+review-session-1/);
	assert.match(injectedPrompt, /submissionRoundId:\s+round-1/);
	assert.match(injectedPrompt, /diff_review_reply/);
	assert.match(injectedPrompt, /must call the diff_review_reply tool/i);
	assert.match(injectedPrompt, /do not reply only with freeform chat text/i);
	assert.equal(injectedRound?.id, "round-1");
});

test("completed submission rounds clear pending state and allow later submits", async () => {
	const session = makeSessionWithOpenThread();
	const successfulInject = async () => {};

	const round = await submitReview(session, successfulInject);
	completeSubmissionRound(session, round.id);
	assert.equal(session.pendingSubmission, null);

	const nextRound = await submitReview(session, successfulInject);
	assert.notEqual(nextRound.id, round.id);
});

test("restored sessions derive the next submission round after the max historical or pending round id", async () => {
	const store = createReviewSessionStore();
	const session = store.create({
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
		files: [{ path: "src/a.ts" }],
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
		pendingSubmission: {
			id: "round-3",
			reviewSessionId: "seeded-review-session",
			threadIds: ["thread-1"],
		},
		submissionHistory: [
			{ id: "round-2", reviewSessionId: "seeded-review-session", threadIds: [] },
			{ id: "round-5", reviewSessionId: "seeded-review-session", threadIds: [] },
		],
	});

	completeSubmissionRound(session, "round-3");
	session.threads[0].root.status = "open";
	const nextRound = await submitReview(session, async () => {});

	assert.equal(nextRound.id, "round-6");
});

test("restored sessions derive the next reply id after the max existing reply id", async () => {
	const store = createReviewSessionStore();
	const session = store.create({
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
		files: [{ path: "src/a.ts" }],
		pendingSubmission: {
			id: "round-1",
			reviewSessionId: "seeded-review-session",
			threadIds: ["thread-1", "thread-2"],
		},
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
				replies: [
					{
						id: "reply-3",
						threadId: "thread-1",
						path: "src/a.ts",
						reply: "Earlier reply",
						recordedAt: 1,
					},
				],
			},
			{
				id: "thread-2",
				path: "src/a.ts",
				root: {
					id: "comment-2",
					path: "src/a.ts",
					body: "Another thread",
					status: "submitted",
					line: { startLine: 8, endLine: 9, targetSide: "new" },
				},
				replies: [
					{
						id: "reply-8",
						threadId: "thread-2",
						path: "src/a.ts",
						reply: "Latest historical reply",
						recordedAt: 2,
					},
				],
			},
		],
	});

	const reply = await recordReply(store, {
		reviewSessionId: session.reviewSessionId,
		submissionRoundId: "round-1",
		threadId: "thread-1",
		path: "src/a.ts",
		line: { startLine: 4, endLine: 6, targetSide: "new" },
		reply: "New reply",
	});

	assert.equal(reply.id, "reply-9");
});
