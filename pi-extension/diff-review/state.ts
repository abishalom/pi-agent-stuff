import { buildReviewPrompt } from "./prompt.ts";
import type { ReviewSession, ReviewSessionSeed, ReviewSubmissionRound } from "./types.ts";

function makeStoreKey(piSessionKey: string, repoRoot: string) {
	return `${piSessionKey}::${repoRoot}`;
}

function normalizeSession(seed: ReviewSessionSeed, reviewSessionId: string): ReviewSession {
	const pendingSubmission = seed.pendingSubmission
		? {
			...seed.pendingSubmission,
			reviewSessionId,
		  }
		: null;

	return {
		piSessionKey: seed.piSessionKey,
		repoRoot: seed.repoRoot,
		reviewSessionId,
		serverSecret: seed.serverSecret ?? `server-secret-${reviewSessionId}`,
		diffMode: seed.diffMode ?? "working-tree-vs-head",
		files: seed.files ? [...seed.files] : [],
		threads: seed.threads ? [...seed.threads] : [],
		pendingSubmission,
		submissionHistory: seed.submissionHistory ? [...seed.submissionHistory] : [],
		nextSubmissionRound:
			seed.nextSubmissionRound ??
			((pendingSubmission ? parseRoundNumber(pendingSubmission.id) + 1 : 1) || 1),
		nextReplyId: seed.nextReplyId ?? 1,
	};
}

function parseRoundNumber(roundId: string) {
	const match = /^round-(\d+)$/.exec(roundId);
	return match ? Number(match[1]) : 0;
}

function parseReviewSessionNumber(reviewSessionId: string) {
	const match = /^review-session-(\d+)$/.exec(reviewSessionId);
	return match ? Number(match[1]) : 0;
}

function createSubmissionRound(session: ReviewSession): ReviewSubmissionRound {
	return {
		id: `round-${session.nextSubmissionRound}`,
		reviewSessionId: session.reviewSessionId,
		threadIds: session.threads.filter((thread) => thread.root.status === "open").map((thread) => thread.id),
		createdAt: Date.now(),
	};
}

function markThreadsSubmitted(session: ReviewSession, threadIds: string[]) {
	for (const thread of session.threads) {
		if (threadIds.includes(thread.id)) {
			thread.root.status = "submitted";
		}
	}
}

export function createReviewSessionStore() {
	const byKey = new Map<string, ReviewSession>();
	const byId = new Map<string, ReviewSession>();
	let nextReviewSessionId = 1;

	return {
		create(seed: ReviewSessionSeed) {
			const key = makeStoreKey(seed.piSessionKey, seed.repoRoot);
			const existing = byKey.get(key);
			if (existing) return existing;
			const reviewSessionId = seed.reviewSessionId ?? `review-session-${nextReviewSessionId++}`;
			nextReviewSessionId = Math.max(nextReviewSessionId, parseReviewSessionNumber(reviewSessionId) + 1);
			const session = normalizeSession(seed, reviewSessionId);
			byKey.set(key, session);
			byId.set(session.reviewSessionId, session);
			return session;
		},
		getById(reviewSessionId: string) {
			return byId.get(reviewSessionId) ?? null;
		},
	};
}

export async function submitReview(session: ReviewSession, injectMessage: (prompt: string, round: ReviewSubmissionRound) => Promise<void> | void) {
	if (session.pendingSubmission) {
		throw new Error("Review submission already pending");
	}
	const round = createSubmissionRound(session);
	const prompt = buildReviewPrompt(session, round);
	await injectMessage(prompt, round);
	session.pendingSubmission = round;
	session.nextSubmissionRound += 1;
	markThreadsSubmitted(session, round.threadIds);
	return round;
}

export function completeSubmissionRound(session: ReviewSession, roundId: string) {
	if (session.pendingSubmission?.id !== roundId) {
		return;
	}
	session.submissionHistory.push({
		...session.pendingSubmission,
		completedAt: Date.now(),
	});
	session.pendingSubmission = null;
}
