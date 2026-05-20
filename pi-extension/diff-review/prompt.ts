import type { ReviewSession, ReviewSubmissionRound } from "./types.ts";

function formatLine(line: { startLine: number; endLine: number; targetSide: string }) {
	return `startLine=${line.startLine}, endLine=${line.endLine}, targetSide=${line.targetSide}`;
}

function encodePromptString(value: string) {
	return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function formatTimeline(session: Pick<ReviewSession, "threads">, round: Pick<ReviewSubmissionRound, "itemIds">, threadId: string) {
	const thread = session.threads.find((candidate) => candidate.id === threadId);
	if (!thread) {
		return "";
	}
	const openItemIds = new Set(round.itemIds);
	const timeline = [
		{
			kind: thread.root.line ? "line/range comment" : "file-level comment",
			itemId: thread.root.id,
			author: "user",
			text: thread.root.body,
			line: thread.root.line,
			createdAt: thread.root.createdAt ?? 0,
		},
		...(thread.userReplies ?? []).map((reply) => ({
			kind: "thread reply",
			itemId: reply.id,
			author: "user",
			text: reply.body,
			line: reply.line,
			createdAt: reply.createdAt ?? 0,
		})),
		...thread.replies.map((reply) => ({
			kind: "pi reply",
			itemId: reply.id,
			author: "pi",
			text: reply.reply,
			line: reply.line,
			createdAt: reply.recordedAt,
		})),
	].sort((left, right) => left.createdAt - right.createdAt);

	const path = encodePromptString(thread.path);
	const anchor = thread.root.line ? `; line reference: ${formatLine(thread.root.line)}` : "";
	const lines = [
		`- threadId=${encodePromptString(thread.id)}; commentId=${encodePromptString(thread.root.id)}; pathJson=${path}; rootKind=${thread.root.line ? "line/range comment" : "file-level comment"}${anchor}`,
	];
	for (const entry of timeline) {
		const marker = openItemIds.has(entry.itemId) ? "[NEW]" : "[context]";
		const line = entry.line ? `; line reference: ${formatLine(entry.line)}` : "";
		lines.push(`  - ${marker} author=${entry.author}; kind=${entry.kind}; itemId=${encodePromptString(entry.itemId)}${line}; bodyJson=${encodePromptString(entry.text)}`);
	}
	return lines.join("\n");
}

export function buildReviewPrompt(
	session: Pick<ReviewSession, "reviewSessionId" | "diffMode" | "files" | "threads">,
	round: Pick<ReviewSubmissionRound, "id" | "threadIds" | "itemIds">,
) {
	const threadLines = round.threadIds.map((threadId) => formatTimeline(session, round, threadId)).filter(Boolean).join("\n");
	const fileLines = session.files.map((file) => `- ${encodePromptString(file.path)}`).join("\n");

	return [
		"You are reviewing a diff review submission.",
		`reviewSessionId: ${encodePromptString(session.reviewSessionId)}`,
		`submissionRoundId: ${encodePromptString(round.id)}`,
		`diffMode: ${session.diffMode}`,
		"Files in scope:",
		fileLines,
		"Thread timeline for this submission round:",
		threadLines,
		"Reply instructions:",
		"- You may reply to any subset of threads, including none.",
		"- If the user requests a code change, you may inspect and edit the repo to make that change before replying.",
		"- If you make code changes, say what you changed in the relevant diff_review_reply tool call.",
		"- You must call the diff_review_reply tool for every reply.",
		"- You must call the diff_review_complete tool even if you send zero replies.",
		"- Do not reply only with freeform chat text.",
		"- Include reviewSessionId, submissionRoundId, path, exactly one of threadId or commentId, and plain-text reply content when calling diff_review_reply.",
		"- Call diff_review_complete only after you are fully done with the round.",
	].join("\n");
}
