import type {
	BootstrapPayload,
	ConnectionState,
	DraftComment,
	LineAnchor,
	ReviewComment,
	ReviewReply,
	ReviewThread,
	SessionClosedEvent,
	SessionStateEvent,
} from "../types.ts";

export type ReviewSessionState = ReturnType<typeof createReviewSessionState>;

function cloneComment(comment: ReviewComment): ReviewComment {
	return { ...comment, line: comment.line ? { ...comment.line } : undefined };
}

function cloneThread(thread: ReviewThread): ReviewThread {
	return {
		...thread,
		root: cloneComment(thread.root),
		userReplies: (thread.userReplies ?? []).map((reply) => cloneComment(reply)),
		replies: [...thread.replies],
	};
}

function cloneThreads(threads: ReviewThread[]) {
	return threads.map((thread) => cloneThread(thread));
}

function findThread(threads: ReviewThread[], threadId: string) {
	return threads.find((candidate) => candidate.id === threadId) ?? null;
}

export function createReviewSessionState(payload: BootstrapPayload) {
	let nextDraftId = 1;
	const listeners = new Set<() => void>();
	const collapsedThreadIds = new Set<string>();
	const state = {
		reviewSessionId: payload.reviewSessionId,
		repoRoot: payload.repoRoot,
		diffMode: payload.diffMode,
		requestedMode: payload.requestedMode,
		effectiveMode: payload.effectiveMode,
		mergeBaseWarning: payload.warning ?? null,
		pendingSubmission: payload.pendingSubmission,
		submissionHistory: [...payload.submissionHistory],
		files: [...payload.files],
		paths: [...payload.paths],
		changedPaths: [...payload.changedPaths],
		changedFiles: [...payload.changedFiles],
		threads: cloneThreads(payload.threads),
		selectedPath: payload.changedPaths[0] ?? payload.paths[0] ?? payload.files[0]?.path ?? null,
		focusedThreadId: null as string | null,
		showChangedOnly: true,
		draft: null as DraftComment | null,
		connectionState: "connecting" as ConnectionState,
		errorMessage: null as string | null,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit() {
			for (const listener of listeners) listener();
		},
		selectPath(path: string) {
			state.selectedPath = path;
			state.focusedThreadId = null;
			state.emit();
		},
		setShowChangedOnly(value: boolean) {
			state.showChangedOnly = value;
			if (value && state.selectedPath && !state.changedPaths.includes(state.selectedPath)) {
				state.selectedPath = state.changedPaths[0] ?? null;
			}
			state.emit();
		},
		startFileDraft(path: string) {
			state.selectedPath = path;
			state.focusedThreadId = null;
			state.draft = { id: `draft-${nextDraftId++}`, kind: "thread", path, text: "" };
			state.emit();
		},
		startLineDraft(line: LineAnchor) {
			state.selectedPath = line.path;
			state.focusedThreadId = null;
			state.draft = { id: `draft-${nextDraftId++}`, kind: "thread", path: line.path, line, text: "" };
			state.emit();
		},
		startReplyDraft(threadId: string) {
			const thread = findThread(state.threads, threadId);
			if (!thread) return;
			state.selectedPath = thread.path;
			state.focusedThreadId = threadId;
			state.draft = {
				id: `draft-${nextDraftId++}`,
				kind: "reply",
				threadId,
				path: thread.path,
				line: thread.root.line,
				text: "",
			};
			state.emit();
		},
		updateDraftText(text: string) {
			if (!state.draft) return;
			state.draft = { ...state.draft, text };
			state.emit();
		},
		clearDraft() {
			state.draft = null;
			state.emit();
		},
		focusThread(threadId: string) {
			const thread = findThread(state.threads, threadId);
			if (!thread) return;
			state.focusedThreadId = threadId;
			state.selectedPath = thread.path;
			state.emit();
		},
		clearFocusedThread() {
			if (!state.focusedThreadId) return;
			state.focusedThreadId = null;
			state.emit();
		},
		replaceThread(thread: ReviewThread, options?: { emit?: boolean }) {
			const nextThread = cloneThread(thread);
			const existingIndex = state.threads.findIndex((candidate) => candidate.id === thread.id);
			if (existingIndex >= 0) {
				state.threads = state.threads.map((candidate, index) => index === existingIndex ? nextThread : candidate);
			} else {
				state.threads = [...state.threads, nextThread];
			}
			if (!state.files.some((file) => file.path === nextThread.path)) {
				state.files = [...state.files, { path: nextThread.path }];
			}
			if (options?.emit !== false) {
				state.emit();
			}
		},
		applyUserReply(event: { threadId: string; reply: ReviewComment }) {
			const thread = findThread(state.threads, event.threadId);
			if (!thread) return;
			thread.userReplies = [...(thread.userReplies ?? []), cloneComment(event.reply)];
			state.draft = state.draft?.kind === "reply" && state.draft.threadId === event.threadId ? null : state.draft;
			state.emit();
		},
		toggleThreadCollapsed(threadId: string) {
			if (collapsedThreadIds.has(threadId)) {
				collapsedThreadIds.delete(threadId);
			} else {
				collapsedThreadIds.add(threadId);
			}
			state.emit();
		},
		isThreadCollapsed(threadId: string) {
			return collapsedThreadIds.has(threadId);
		},
		applyBootstrap(next: BootstrapPayload) {
			state.reviewSessionId = next.reviewSessionId;
			state.repoRoot = next.repoRoot;
			state.diffMode = next.diffMode;
			state.requestedMode = next.requestedMode;
			state.effectiveMode = next.effectiveMode;
			state.mergeBaseWarning = next.warning ?? null;
			state.pendingSubmission = next.pendingSubmission;
			state.submissionHistory = [...next.submissionHistory];
			state.files = [...next.files];
			state.focusedThreadId = null;
			state.applyTree(next, { emit: false, fallbackPath: next.files[0]?.path ?? null });
			state.threads = cloneThreads(next.threads);
			state.connectionState = "open";
			state.errorMessage = null;
			state.emit();
		},
		applyTree(next: Pick<BootstrapPayload, "paths" | "changedPaths" | "changedFiles">, options?: { emit?: boolean; fallbackPath?: string | null }) {
			state.paths = [...next.paths];
			state.changedPaths = [...next.changedPaths];
			state.changedFiles = [...next.changedFiles];
			const mustReselect = !state.selectedPath
				|| !state.paths.includes(state.selectedPath)
				|| (state.showChangedOnly && !state.changedPaths.includes(state.selectedPath));
			if (mustReselect) {
				state.selectedPath = state.changedPaths[0] ?? state.paths[0] ?? options?.fallbackPath ?? null;
				state.focusedThreadId = null;
			}
			if (options?.emit !== false) {
				state.emit();
			}
		},
		applySessionState(event: SessionStateEvent) {
			state.diffMode = event.diffMode;
			state.pendingSubmission = event.pendingSubmission;
			state.submissionHistory = [...event.submissionHistory];
			state.connectionState = "open";
			state.errorMessage = null;
			state.emit();
		},
		applyReply(event: ReviewReply) {
			const thread = event.threadId ? findThread(state.threads, event.threadId) : null;
			if (thread) {
				thread.replies = [...thread.replies, event];
			} else {
				state.threads = [...state.threads, {
					id: event.threadId ?? `reply-thread-${event.id}`,
					path: event.path,
					root: {
						id: event.commentId ?? `reply-root-${event.id}`,
						path: event.path,
						body: "Pi reply",
						status: "submitted",
						line: event.line,
					},
					userReplies: [],
					replies: [event],
				}];
			}
			state.connectionState = "open";
			state.errorMessage = null;
			state.emit();
		},
		applyConnectionError(message: string) {
			if (state.connectionState === "closed") {
				state.emit();
				return;
			}
			state.connectionState = "error";
			state.errorMessage = message;
			state.emit();
		},
		applySessionClosed(event: SessionClosedEvent) {
			state.connectionState = "closed";
			state.errorMessage = event.message ?? "This diff review session has ended. Reload to reconnect.";
			state.emit();
		},
		getBannerMessage() {
			return state.errorMessage ?? state.mergeBaseWarning;
		},
		getVisiblePaths() {
			return state.showChangedOnly ? [...state.changedPaths] : [...state.paths];
		},
		getThreadsForSelectedPath() {
			if (!state.selectedPath) return [];
			return state.threads.filter((thread) => thread.path === state.selectedPath);
		},
	};
	return state;
}
