import type { DraftComment, LineAnchor, ReviewThread } from "./types.ts";

export function getSubmitButtonLabel(pending: boolean) {
	return pending ? "Waiting for Pi…" : "Submit feedback";
}

export function getComposerIdleActions() {
	return ["File comment"];
}

export function getGutterCommentLabel() {
	return "+";
}

export function formatAnchor(line?: LineAnchor) {
	if (!line) return null;
	if (line.startLine === line.endLine) {
		return `${line.startLine}`;
	}
	return `${line.startLine}-${line.endLine}`;
}

export function formatPathWithAnchor(path: string, line?: LineAnchor) {
	const anchor = formatAnchor(line);
	return anchor ? `${path}:${anchor}` : path;
}

export function formatDraftLabel(draft: DraftComment) {
	const location = formatPathWithAnchor(draft.path, draft.line);
	if (draft.kind === "reply") {
		return `Reply · ${location}`;
	}
	if (!draft.line) {
		return `File comment · ${location}`;
	}
	if (draft.line.startLine === draft.line.endLine) {
		return `Line comment · ${location}`;
	}
	return `Range comment · ${location}`;
}

export type ThreadTimelineEntry = {
	id: string;
	author: "You" | "Pi";
	text: string;
	line?: LineAnchor;
	createdAt: number;
};

export function buildThreadTimeline(thread: ReviewThread): ThreadTimelineEntry[] {
	const items: ThreadTimelineEntry[] = [
		{
			id: thread.root.id,
			author: "You",
			text: thread.root.body,
			line: thread.root.line,
			createdAt: thread.root.createdAt ?? 0,
		},
		...(thread.userReplies ?? []).map((reply) => ({
			id: reply.id,
			author: "You" as const,
			text: reply.body,
			line: reply.line,
			createdAt: reply.createdAt ?? 0,
		})),
		...thread.replies.map((reply) => ({
			id: reply.id,
			author: "Pi" as const,
			text: reply.reply,
			line: reply.line,
			createdAt: reply.recordedAt,
		})),
	];
	return items.sort((left, right) => left.createdAt - right.createdAt);
}
