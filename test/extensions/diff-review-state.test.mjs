import test from "node:test";
import assert from "node:assert/strict";

import {
	completeSubmissionRound,
	createReviewSessionStore,
	submitReview,
} from "../../pi-extension/diff-review/state.ts";

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
