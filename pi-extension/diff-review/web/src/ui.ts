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

function normalizeLineAnchor(path: string, line: LineAnchor | undefined) {
	if (!line) return null;
	return { path, ...line };
}

export function getSelectedDraftAnchor(
	draft: DraftComment | null | undefined,
	selectedPath: string | null | undefined,
) {
	if (!draft || draft.path !== selectedPath) return null;
	return normalizeLineAnchor(draft.path, draft.line);
}

export function reuseShallowEqualArray<T>(previous: readonly T[], next: readonly T[]) {
	if (previous === next) return previous;
	if (previous.length !== next.length) return next;
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) return next;
	}
	return previous;
}

export function getFocusedThreadAnchor(
	threads: readonly ReviewThread[],
	focusedThreadId: string | null | undefined,
	selectedPath: string | null | undefined,
) {
	if (!focusedThreadId) return null;
	const thread = threads.find((candidate) => candidate.id === focusedThreadId);
	if (!thread) return null;
	if (selectedPath && thread.path !== selectedPath) return null;
	return normalizeLineAnchor(thread.path, thread.root.line);
}

export function getActiveDiffAnchor({
	draft,
	selectedPath,
	threads,
	focusedThreadId,
}: {
	draft: DraftComment | null | undefined;
	selectedPath: string | null | undefined;
	threads: readonly ReviewThread[];
	focusedThreadId: string | null | undefined;
}) {
	return getSelectedDraftAnchor(draft, selectedPath) ?? getFocusedThreadAnchor(threads, focusedThreadId, selectedPath);
}

export function getThreadCardLayout(collapsed: boolean, isFocused: boolean) {
	return {
		background: isFocused ? "#172554" : collapsed ? "#0b1220" : "#111827",
		borderColor: isFocused ? "#2563eb" : "#1e293b",
		boxShadow: isFocused ? "0 0 0 1px rgba(37,99,235,0.2)" : undefined,
		gap: collapsed ? 6 : 10,
		headerGap: collapsed ? 8 : 10,
		padding: collapsed ? 10 : 12,
		showCollapsedSummary: collapsed,
	};
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
