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

test("submit state is atomic when Pi injection fails", async () => {
	const session = makeSessionWithOpenThread();
	const failingInject = async () => {
		throw new Error("inject failed");
	};

	await assert.rejects(() => submitReview(session, failingInject), /inject failed/);
	assert.equal(session.pendingSubmission, null);
	assert.equal(session.threads[0].root.status, "open");
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
