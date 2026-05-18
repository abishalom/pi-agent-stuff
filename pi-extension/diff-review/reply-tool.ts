import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffReviewReplyParams, RecordedDiffReviewReply, ReviewSession, TargetSide } from "./types.ts";

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
	const thread = session.threads.find(
		(candidate) => candidate.root.id === params.commentId || candidate.replies.some((reply) => reply.id === params.commentId),
	);
	if (!thread) {
		throw new Error("Unknown comment target");
	}
	return thread;
}

export async function recordReply(store: { getById(reviewSessionId: string): ReviewSession | null }, params: DiffReviewReplyParams): Promise<RecordedDiffReviewReply> {
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
		threadId: params.threadId,
		commentId: params.commentId,
		path: params.path,
		reply: params.reply,
		line: params.line,
		recordedAt: Date.now(),
	};
	thread.replies.push(recordedReply);
	return recordedReply;
}

export function createDiffReviewReplyTool(store: { getById(reviewSessionId: string): ReviewSession | null }) {
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
			return recordReply(store, params);
		},
	});
}

export function registerDiffReviewReplyTool(pi: ExtensionAPI, store: { getById(reviewSessionId: string): ReviewSession | null }) {
	pi.registerTool(createDiffReviewReplyTool(store));
}
