import type {
	BootstrapPayload,
	ConnectionState,
	DraftComment,
	LineAnchor,
	ReviewReply,
	ReviewThread,
	SessionClosedEvent,
	SessionStateEvent,
} from "../types.ts";

export type ReviewSessionState = ReturnType<typeof createReviewSessionState>;

export function createReviewSessionState(payload: BootstrapPayload) {
	let nextDraftId = 1;
	const listeners = new Set<() => void>();
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
		showChangedOnly: false,
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
			state.emit();
		},
		setShowChangedOnly(value: boolean) {
			state.showChangedOnly = value;
			if (value && state.selectedPath && !state.changedPaths.includes(state.selectedPath)) {
				state.selectedPath = state.changedPaths[0] ?? null;
			}
			state.emit();
		},
		startDraft(anchor: LineAnchor) {
			state.selectedPath = anchor.path;
			state.draft = { id: `draft-${nextDraftId++}` , anchor, text: "" };
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
		commitDraftToThread() {
			if (!state.draft || !state.draft.text.trim()) return null;
			const thread: ReviewThread = {
				id: `local-thread-${Date.now()}`,
				path: state.draft.anchor.path,
				root: {
					id: `local-comment-${Date.now()}`,
					path: state.draft.anchor.path,
					body: state.draft.text.trim(),
					status: "open",
					line: state.draft.anchor,
				},
				replies: [],
			};
			state.threads = [...state.threads, thread];
			state.draft = null;
			state.emit();
			return thread;
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
			state.paths = [...next.paths];
			state.changedPaths = [...next.changedPaths];
			state.changedFiles = [...next.changedFiles];
			state.threads = cloneThreads(next.threads);
			if (!state.selectedPath || !state.paths.includes(state.selectedPath)) {
				state.selectedPath = next.changedPaths[0] ?? next.paths[0] ?? next.files[0]?.path ?? null;
			}
			state.connectionState = "open";
			state.errorMessage = null;
			state.emit();
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
			const thread = state.threads.find((candidate) => candidate.id === event.threadId);
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

function cloneThreads(threads: ReviewThread[]) {
	return threads.map((thread) => ({
		...thread,
		root: { ...thread.root },
		replies: [...thread.replies],
	}));
}
