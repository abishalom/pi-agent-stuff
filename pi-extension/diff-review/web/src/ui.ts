import type { DraftComment, LineAnchor, ReviewThread } from "./types.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost";

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
		height: collapsed ? 88 : undefined,
		overflow: collapsed ? "hidden" : "visible",
		padding: collapsed ? 10 : 12,
		showCollapsedSummary: collapsed,
		summaryLineClamp: collapsed ? 2 : undefined,
		toggleButtonSize: 32,
	};
}

export function getButtonStyle(variant: ButtonVariant, options?: { disabled?: boolean; fullWidth?: boolean; compact?: boolean }) {
	const disabled = options?.disabled === true;
	const compact = options?.compact === true;
	const base = {
		appearance: "none",
		alignItems: "center",
		borderRadius: compact ? 10 : 12,
		border: "1px solid #334155",
		cursor: disabled ? "not-allowed" : "pointer",
		display: "inline-flex",
		fontSize: 13,
		fontWeight: 600,
		height: compact ? 32 : 36,
		justifyContent: "center",
		lineHeight: 1,
		outline: "none",
		padding: compact ? "0 10px" : "0 12px",
		transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
		width: options?.fullWidth ? "100%" : undefined,
	};
	if (variant === "primary") {
		return {
			...base,
			background: disabled ? "#1e293b" : "#2563eb",
			borderColor: disabled ? "#334155" : "#3b82f6",
			color: disabled ? "#94a3b8" : "#f8fafc",
		};
	}
	if (variant === "ghost") {
		return {
			...base,
			background: "transparent",
			borderColor: "#1e293b",
			color: disabled ? "#64748b" : "#cbd5e1",
		};
	}
	return {
		...base,
		background: "#0f172a",
		borderColor: "#334155",
		color: disabled ? "#64748b" : "#e2e8f0",
	};
}

export function getSelectStyle() {
	return {
		appearance: "none",
		background: "#0f172a",
		border: "1px solid #334155",
		borderRadius: 12,
		color: "#e2e8f0",
		height: 36,
		outline: "none",
		padding: "0 36px 0 12px",
	};
}

export function getTextFieldStyle(options?: { minHeight?: number }) {
	return {
		background: "#020617",
		border: "1px solid #334155",
		borderRadius: 12,
		color: "#e2e8f0",
		font: "inherit",
		lineHeight: 1.5,
		minHeight: options?.minHeight,
		outline: "none",
		padding: "10px 12px",
		resize: "vertical",
		width: "100%",
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
