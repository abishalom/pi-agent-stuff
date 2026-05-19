import { buildReviewPrompt } from "./prompt.ts";
import type {
	DiffReviewComment,
	RecordedDiffReviewReply,
	ReviewSession,
	ReviewSessionSeed,
	ReviewSubmissionRound,
} from "./types.ts";

function makeStoreKey(piSessionKey: string, repoRoot: string) {
	return JSON.stringify([piSessionKey, repoRoot]);
}

function parseRoundNumber(roundId: string) {
	const match = /^round-(\d+)$/.exec(roundId);
	return match ? Number(match[1]) : 0;
}

function parseThreadNumber(threadId: string) {
	const match = /^thread-(\d+)$/.exec(threadId);
	return match ? Number(match[1]) : 0;
}

function parseCommentNumber(commentId: string) {
	const match = /^comment-(\d+)$/.exec(commentId);
	return match ? Number(match[1]) : 0;
}

function parseReplyNumber(replyId: string) {
	const match = /^reply-(\d+)$/.exec(replyId);
	return match ? Number(match[1]) : 0;
}

function parseReviewSessionNumber(reviewSessionId: string) {
	const match = /^review-session-(\d+)$/.exec(reviewSessionId);
	return match ? Number(match[1]) : 0;
}

function cloneComment(comment: DiffReviewComment): DiffReviewComment {
	return { ...comment, line: comment.line ? { ...comment.line } : undefined };
}

function cloneThread(thread: ReviewSession["threads"][number]): ReviewSession["threads"][number] {
	return {
		...thread,
		root: cloneComment(thread.root),
		userReplies: (thread.userReplies ?? []).map((reply) => cloneComment(reply)),
		replies: [...thread.replies],
	};
}

function findThread(session: ReviewSession, threadId: string) {
	return session.threads.find((candidate) => candidate.id === threadId) ?? null;
}

function deriveRoundItemIds(threadIds: string[], threads: ReviewSession["threads"]) {
	return threadIds.flatMap((threadId) => {
		const thread = threads.find((candidate) => candidate.id === threadId);
		return thread ? [thread.root.id] : [];
	});
}

function normalizeRound(
	round: ReviewSubmissionRound,
	reviewSessionId: string,
	threads: ReviewSession["threads"],
): ReviewSubmissionRound {
	return {
		...round,
		reviewSessionId,
		threadIds: [...round.threadIds],
		itemIds: round.itemIds ? [...round.itemIds] : deriveRoundItemIds(round.threadIds, threads),
	};
}

function normalizeSession(seed: ReviewSessionSeed, reviewSessionId: string): ReviewSession {
	const threads = (seed.threads ?? []).map((thread) => cloneThread(thread));
	const pendingSubmission = seed.pendingSubmission
		? normalizeRound(seed.pendingSubmission, reviewSessionId, threads)
		: null;
	const submissionHistory = (seed.submissionHistory ?? []).map((round) => normalizeRound(round, reviewSessionId, threads));

	return {
		piSessionKey: seed.piSessionKey,
		repoRoot: seed.repoRoot,
		reviewSessionId,
		serverSecret: seed.serverSecret ?? `server-secret-${reviewSessionId}`,
		diffMode: seed.diffMode ?? "working-tree-vs-head",
		files: seed.files ? [...seed.files] : [],
		threads,
		pendingSubmission,
		submissionHistory,
		nextSubmissionRound:
			seed.nextSubmissionRound ??
			Math.max(
				pendingSubmission ? parseRoundNumber(pendingSubmission.id) + 1 : 1,
				...submissionHistory.map((round) => parseRoundNumber(round.id) + 1),
			),
		nextThreadId:
			seed.nextThreadId ??
			Math.max(1, ...threads.map((thread) => parseThreadNumber(thread.id) + 1)),
		nextCommentId:
			seed.nextCommentId ??
			Math.max(
				1,
				...threads.flatMap((thread) => [
					parseCommentNumber(thread.root.id) + 1,
					...(thread.userReplies ?? []).map((reply) => parseCommentNumber(reply.id) + 1),
				]),
			),
		nextReplyId:
			seed.nextReplyId ??
			Math.max(1, ...threads.flatMap((thread) => thread.replies.map((reply) => parseReplyNumber(reply.id) + 1))),
	};
}

function collectOpenItems(session: ReviewSession) {
	return session.threads.flatMap((thread) => {
		const openItems: Array<{ threadId: string; itemId: string }> = [];
		if (thread.root.status === "open") {
			openItems.push({ threadId: thread.id, itemId: thread.root.id });
		}
		for (const reply of thread.userReplies ?? []) {
			if (reply.status === "open") {
				openItems.push({ threadId: thread.id, itemId: reply.id });
			}
		}
		return openItems;
	});
}

function createSubmissionRound(session: ReviewSession): ReviewSubmissionRound {
	const openItems = collectOpenItems(session);
	return {
		id: `round-${session.nextSubmissionRound}`,
		reviewSessionId: session.reviewSessionId,
		threadIds: [...new Set(openItems.map((item) => item.threadId))],
		itemIds: openItems.map((item) => item.itemId),
		createdAt: Date.now(),
	};
}

function markSubmitted(session: ReviewSession, itemIds: string[]) {
	const itemIdSet = new Set(itemIds);
	for (const thread of session.threads) {
		if (itemIdSet.has(thread.root.id)) {
			thread.root.status = "submitted";
		}
		for (const reply of thread.userReplies ?? []) {
			if (itemIdSet.has(reply.id)) {
				reply.status = "submitted";
			}
		}
	}
}

type ReviewSessionEvent =
	| { type: "reply"; payload: RecordedDiffReviewReply }
	| { type: "session-state"; payload: ReviewSession }
	| { type: "session-closed"; payload: { reviewSessionId: string; message?: string } };

type SessionServerHandle = {
	baseUrl: string;
	close(): Promise<void> | void;
};

export function createReviewSessionStore() {
	const byKey = new Map<string, ReviewSession>();
	const byId = new Map<string, ReviewSession>();
	const subscribers = new Map<string, Set<(event: ReviewSessionEvent) => void>>();
	const serverById = new Map<string, SessionServerHandle>();
	let nextReviewSessionId = 1;

	function emit(reviewSessionId: string, event: ReviewSessionEvent) {
		for (const subscriber of subscribers.get(reviewSessionId) ?? []) {
			subscriber(event);
		}
	}

	return {
		create(seed: ReviewSessionSeed) {
			const key = makeStoreKey(seed.piSessionKey, seed.repoRoot);
			const existing = byKey.get(key);
			if (existing) return existing;
			if (seed.reviewSessionId) {
				const existingById = byId.get(seed.reviewSessionId);
				if (existingById && makeStoreKey(existingById.piSessionKey, existingById.repoRoot) !== key) {
					throw new Error(`duplicate reviewSessionId: ${seed.reviewSessionId}`);
				}
			}
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
		getByKey(piSessionKey: string, repoRoot: string) {
			return byKey.get(makeStoreKey(piSessionKey, repoRoot)) ?? null;
		},
		listByPiSessionKey(piSessionKey: string) {
			return [...byId.values()].filter((session) => session.piSessionKey === piSessionKey);
		},
		remove(reviewSessionId: string) {
			const session = byId.get(reviewSessionId);
			if (!session) return null;
			byId.delete(reviewSessionId);
			byKey.delete(makeStoreKey(session.piSessionKey, session.repoRoot));
			serverById.delete(reviewSessionId);
			subscribers.delete(reviewSessionId);
			return session;
		},
		subscribe(reviewSessionId: string, listener: (event: ReviewSessionEvent) => void) {
			const sessionSubscribers = subscribers.get(reviewSessionId) ?? new Set();
			sessionSubscribers.add(listener);
			subscribers.set(reviewSessionId, sessionSubscribers);
			return () => {
				sessionSubscribers.delete(listener);
				if (sessionSubscribers.size === 0) subscribers.delete(reviewSessionId);
			};
		},
		emitSessionState(session: ReviewSession) {
			emit(session.reviewSessionId, { type: "session-state", payload: session });
		},
		emitSessionClosed(reviewSessionId: string, message?: string) {
			emit(reviewSessionId, { type: "session-closed", payload: { reviewSessionId, message } });
		},
		appendReply(reply: RecordedDiffReviewReply) {
			const session = byId.get(reply.reviewSessionId);
			if (!session) {
				throw new Error("Unknown review session");
			}
			const thread = findThread(session, reply.threadId);
			if (!thread) {
				throw new Error("Unknown thread target");
			}
			thread.replies.push(reply);
			emit(reply.reviewSessionId, { type: "reply", payload: reply });
			return reply;
		},
		attachServer(reviewSessionId: string, server: SessionServerHandle) {
			serverById.set(reviewSessionId, server);
		},
		getServer(reviewSessionId: string) {
			return serverById.get(reviewSessionId) ?? null;
		},
		detachServer(reviewSessionId: string) {
			serverById.delete(reviewSessionId);
		},
	};
}

export function appendThread(
	session: ReviewSession,
	input: { path: string; body: string; line?: ReviewSession["threads"][number]["root"]["line"] },
) {
	const thread = {
		id: `thread-${session.nextThreadId++}`,
		path: input.path,
		root: {
			id: `comment-${session.nextCommentId++}`,
			path: input.path,
			body: input.body,
			status: "open" as const,
			line: input.line,
			createdAt: Date.now(),
		},
		userReplies: [],
		replies: [],
	};
	if (!session.files.some((file) => file.path === input.path)) {
		session.files.push({ path: input.path });
	}
	session.threads.push(thread);
	return thread;
}

export function appendThreadReply(
	session: ReviewSession,
	input: { threadId: string; body: string },
) {
	const thread = findThread(session, input.threadId);
	if (!thread) {
		throw new Error("Unknown thread target");
	}
	const reply: DiffReviewComment = {
		id: `comment-${session.nextCommentId++}`,
		path: thread.path,
		body: input.body,
		status: "open",
		line: thread.root.line,
		createdAt: Date.now(),
	};
	thread.userReplies = [...(thread.userReplies ?? []), reply];
	return reply;
}

export async function submitReview(
	session: ReviewSession,
	injectMessage: (prompt: string, round: ReviewSubmissionRound) => Promise<void> | void,
) {
	if (session.pendingSubmission) {
		throw new Error("Review submission already pending");
	}
	const round = createSubmissionRound(session);
	const prompt = buildReviewPrompt(session, round);
	await injectMessage(prompt, round);
	session.pendingSubmission = round;
	session.nextSubmissionRound += 1;
	markSubmitted(session, round.itemIds);
	return round;
}

export function completeSubmissionRound(session: ReviewSession, roundId: string) {
	if (!session.pendingSubmission) {
		throw new Error("No pending submission round");
	}
	if (session.pendingSubmission.id !== roundId) {
		throw new Error(`Unknown submission round: ${roundId}`);
	}
	const completedRound = {
		...session.pendingSubmission,
		threadIds: [...session.pendingSubmission.threadIds],
		itemIds: [...session.pendingSubmission.itemIds],
		completedAt: Date.now(),
	};
	session.submissionHistory.push(completedRound);
	session.pendingSubmission = null;
	return completedRound;
}
