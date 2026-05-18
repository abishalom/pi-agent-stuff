import type { ReviewSession, ReviewSubmissionRound } from "./types.ts";

function formatLine(line: { startLine: number; endLine: number; targetSide: string }) {
	return `startLine=${line.startLine}, endLine=${line.endLine}, targetSide=${line.targetSide}`;
}

export function buildReviewPrompt(session: Pick<ReviewSession, "reviewSessionId" | "diffMode" | "files" | "threads">, round: Pick<ReviewSubmissionRound, "id" | "threadIds">) {
	const threadIds = new Set(round.threadIds);
	const threadLines = session.threads
		.filter((thread) => threadIds.has(thread.id))
		.map((thread) => {
			const kind = thread.root.line ? "line/range comment" : "file-level comment";
			const line = thread.root.line ? `; line reference: ${formatLine(thread.root.line)}` : "";
			const threadId = JSON.stringify(thread.id);
			const commentId = JSON.stringify(thread.root.id);
			const body = JSON.stringify(thread.root.body);
			const path = JSON.stringify(thread.path);
			return `- threadId=${threadId}; commentId=${commentId}; pathJson=${path}; kind=${kind}${line}; bodyJson=${body}`;
		})
		.join("\n");

	const fileLines = session.files.map((file) => `- ${JSON.stringify(file.path)}`).join("\n");

	return [
		"You are reviewing a diff review submission.",
		`reviewSessionId: ${JSON.stringify(session.reviewSessionId)}`,
		`submissionRoundId: ${JSON.stringify(round.id)}`,
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
