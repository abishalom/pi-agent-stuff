import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeSubmissionRound } from "./state.ts";
import type {
	DiffReviewCompleteParams,
	DiffReviewReplyParams,
	RecordedDiffReviewReply,
	ReviewSession,
	TargetSide,
} from "./types.ts";

function validateLine(line: DiffReviewReplyParams["line"]) {
	if (line == null) {
		return;
	}
	if (!Number.isInteger(line.startLine) || !Number.isInteger(line.endLine) || line.startLine < 1 || line.endLine < 1 || line.startLine > line.endLine) {
		throw new Error("Invalid line reference");
	}
	if (line.targetSide !== "old" && line.targetSide !== "new") {
		throw new Error("Invalid line reference targetSide");
	}
}

function lineMatches(expected: DiffReviewReplyParams["line"], actual: DiffReviewReplyParams["line"]) {
	if (expected == null && actual == null) {
		return true;
	}
	if (expected == null || actual == null) {
		return false;
	}
	return expected.startLine === actual.startLine && expected.endLine === actual.endLine && expected.targetSide === actual.targetSide;
}

function findThread(session: ReviewSession, params: DiffReviewReplyParams) {
	if (!params.threadId && !params.commentId) {
		throw new Error("Reply must include threadId or commentId");
	}
	if (params.threadId && params.commentId) {
		throw new Error("Reply must include exactly one target selector");
	}
	if (params.threadId) {
		const thread = session.threads.find((candidate) => candidate.id === params.threadId);
		if (!thread) {
			throw new Error("Unknown thread target");
		}
		return thread;
	}
	const thread = session.threads.find((candidate) => {
		if (candidate.root.id === params.commentId) return true;
		if ((candidate.userReplies ?? []).some((reply) => reply.id === params.commentId)) return true;
		return candidate.replies.some((reply) => reply.id === params.commentId);
	});
	if (!thread) {
		throw new Error("Unknown comment target");
	}
	return thread;
}

export async function recordReply(
	store: {
		getById(reviewSessionId: string): ReviewSession | null;
		appendReply?: (reply: RecordedDiffReviewReply) => RecordedDiffReviewReply;
	},
	params: DiffReviewReplyParams,
): Promise<RecordedDiffReviewReply> {
	const session = store.getById(params.reviewSessionId);
	if (!session) {
		throw new Error("Unknown review session");
	}
	if (session.pendingSubmission?.id !== params.submissionRoundId) {
		throw new Error("Unknown submission round");
	}
	if (typeof params.path !== "string" || params.path.trim() === "") {
		throw new Error("Reply path is required");
	}
	if (typeof params.reply !== "string" || params.reply.trim() === "") {
		throw new Error("Reply text is required");
	}
	validateLine(params.line);
	const thread = findThread(session, params);
	if (!session.pendingSubmission.threadIds.includes(thread.id)) {
		throw new Error("Reply target is not part of the active round");
	}
	if (params.path !== thread.path) {
		throw new Error("Reply path does not match target thread");
	}
	if (params.line != null && !lineMatches(params.line, thread.root.line)) {
		throw new Error("Reply line does not match target thread");
	}
	const recordedReply: RecordedDiffReviewReply = {
		id: `reply-${session.nextReplyId++}`,
		reviewSessionId: session.reviewSessionId,
		submissionRoundId: params.submissionRoundId,
		threadId: params.threadId ?? thread.id,
		commentId: params.commentId,
		path: params.path,
		reply: params.reply,
		line: params.line,
		recordedAt: Date.now(),
	};
	if (store.appendReply) {
		return store.appendReply(recordedReply);
	}
	thread.replies.push(recordedReply);
	return recordedReply;
}

export async function recordCompletion(
	store: {
		getById(reviewSessionId: string): ReviewSession | null;
		emitSessionState?: (session: ReviewSession) => void;
	},
	params: DiffReviewCompleteParams,
) {
	const session = store.getById(params.reviewSessionId);
	if (!session) {
		throw new Error("Unknown review session");
	}
	const completedRound = completeSubmissionRound(session, params.submissionRoundId);
	store.emitSessionState?.(session);
	return completedRound;
}

export function createDiffReviewReplyTool(store: {
	getById(reviewSessionId: string): ReviewSession | null;
	appendReply?: (reply: RecordedDiffReviewReply) => RecordedDiffReviewReply;
}) {
	return defineTool({
		name: "diff_review_reply",
		label: "Diff Review Reply",
		description: "Reply to a diff review request",
		parameters: Type.Object({
			reviewSessionId: Type.String(),
			submissionRoundId: Type.String(),
			threadId: Type.Optional(Type.String()),
			commentId: Type.Optional(Type.String()),
			path: Type.String(),
			line: Type.Optional(
				Type.Object({
					startLine: Type.Integer(),
					endLine: Type.Integer(),
					targetSide: Type.Union([Type.Literal("old"), Type.Literal("new")]) as unknown as TargetSide,
				}),
			),
			reply: Type.String(),
		}),
		async execute(_toolCallId: string, params: DiffReviewReplyParams) {
			const recordedReply = await recordReply(store, params);
			return {
				content: [
					{
						type: "text" as const,
						text: `Recorded diff review reply ${recordedReply.id} for ${recordedReply.path}.`,
					},
				],
				details: recordedReply,
			};
		},
	});
}

export function createDiffReviewCompleteTool(store: {
	getById(reviewSessionId: string): ReviewSession | null;
	emitSessionState?: (session: ReviewSession) => void;
}) {
	return defineTool({
		name: "diff_review_complete",
		label: "Diff Review Complete",
		description: "Mark a diff review submission round complete and unlock the browser UI",
		parameters: Type.Object({
			reviewSessionId: Type.String(),
			submissionRoundId: Type.String(),
		}),
		async execute(_toolCallId: string, params: DiffReviewCompleteParams) {
			const completedRound = await recordCompletion(store, params);
			return {
				content: [
					{
						type: "text" as const,
						text: `Completed diff review round ${completedRound.id}.`,
					},
				],
				details: completedRound,
			};
		},
	});
}

export function registerDiffReviewReplyTool(
	pi: ExtensionAPI,
	store: {
		getById(reviewSessionId: string): ReviewSession | null;
		appendReply?: (reply: RecordedDiffReviewReply) => RecordedDiffReviewReply;
	},
) {
	pi.registerTool(createDiffReviewReplyTool(store));
}

export function registerDiffReviewCompleteTool(
	pi: ExtensionAPI,
	store: {
		getById(reviewSessionId: string): ReviewSession | null;
		emitSessionState?: (session: ReviewSession) => void;
	},
) {
	pi.registerTool(createDiffReviewCompleteTool(store));
}
