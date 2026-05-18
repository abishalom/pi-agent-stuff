import type { ReviewSession, ReviewSubmissionRound } from "./types.ts";

function formatLine(line: { startLine: number; endLine: number; targetSide: string }) {
	return `startLine=${line.startLine}, endLine=${line.endLine}, targetSide=${line.targetSide}`;
}

function encodePromptString(value: string) {
	return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildReviewPrompt(session: Pick<ReviewSession, "reviewSessionId" | "diffMode" | "files" | "threads">, round: Pick<ReviewSubmissionRound, "id" | "threadIds">) {
	const threadIds = new Set(round.threadIds);
	const threadLines = session.threads
		.filter((thread) => threadIds.has(thread.id))
		.map((thread) => {
			const kind = thread.root.line ? "line/range comment" : "file-level comment";
			const line = thread.root.line ? `; line reference: ${formatLine(thread.root.line)}` : "";
			const threadId = encodePromptString(thread.id);
			const commentId = encodePromptString(thread.root.id);
			const body = encodePromptString(thread.root.body);
			const path = encodePromptString(thread.path);
			return `- threadId=${threadId}; commentId=${commentId}; pathJson=${path}; kind=${kind}${line}; bodyJson=${body}`;
		})
		.join("\n");

	const fileLines = session.files.map((file) => `- ${encodePromptString(file.path)}`).join("\n");

	return [
		"You are reviewing a diff review submission.",
		`reviewSessionId: ${encodePromptString(session.reviewSessionId)}`,
		`submissionRoundId: ${encodePromptString(round.id)}`,
		`diffMode: ${session.diffMode}`,
		"Files in scope:",
		fileLines,
		"Open comments in this submission round:",
		threadLines,
		"Reply instructions:",
		"- You must call the diff_review_reply tool for every reply.",
		"- Do not reply only with freeform chat text.",
		"- Include reviewSessionId, submissionRoundId, path, exactly one of threadId or commentId, and plain-text reply content.",
	].join("\n");
}
