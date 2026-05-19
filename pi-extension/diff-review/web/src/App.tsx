import { useEffect, useMemo, useState } from "react";
import { connectEvents, createThread, createThreadReply, fetchFile, fetchSession, fetchTree, setDiffMode, submitReview } from "./api.ts";
import { DiffToolbar } from "./components/DiffToolbar.tsx";
import { DiffViewer } from "./components/DiffViewer.tsx";
import { FilterBar } from "./components/FilterBar.tsx";
import { CommentSidebar } from "./components/CommentSidebar.tsx";
import { RepoTreePanel } from "./components/RepoTreePanel.tsx";
import { ReviewLayout } from "./components/ReviewLayout.tsx";
import { createReviewSessionState } from "./state/review-session.ts";
import type { BootstrapPayload, DiffFileDetail } from "./types.ts";

export function App() {
	const [sessionState, setSessionState] = useState<ReturnType<typeof createReviewSessionState> | null>(null);
	const [fileDetail, setFileDetail] = useState<DiffFileDetail | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [bootstrapError, setBootstrapError] = useState<string | null>(null);
	const [, rerender] = useState(0);

	useEffect(() => {
		let active = true;
		let source: EventSource | null = null;
		let unsubscribe: (() => void) | null = null;
		(async () => {
			try {
				const payload: BootstrapPayload = await fetchSession();
				if (!active) return;
				const state = createReviewSessionState(payload);
				state.applyBootstrap(payload);
				setSessionState(state);
				unsubscribe = state.subscribe(() => rerender((value) => value + 1));
				source = connectEvents({
					onSessionState: (event) => state.applySessionState(event),
					onReply: (event) => state.applyReply(event),
					onSessionClosed: (event) => state.applySessionClosed(event),
					onError: (message) => state.applyConnectionError(message),
				});
			} catch (error) {
				if (!active) return;
				setBootstrapError(error instanceof Error ? error.message : String(error));
			}
		})();
		return () => {
			active = false;
			unsubscribe?.();
			source?.close();
		};
	}, []);

	useEffect(() => {
		if (!sessionState?.selectedPath) {
			setFileDetail(null);
			return;
		}
		let active = true;
		setFileLoading(true);
		setFileError(null);
		fetchFile(sessionState.selectedPath)
			.then((detail) => {
				if (!active) return;
				setFileDetail(detail);
			})
			.catch((error) => {
				if (!active) return;
				setFileError(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (active) setFileLoading(false);
			});
		return () => {
			active = false;
		};
	}, [sessionState?.selectedPath]);

	const visiblePaths = useMemo(() => sessionState?.getVisiblePaths() ?? [], [sessionState, sessionState?.showChangedOnly, sessionState?.paths, sessionState?.changedPaths]);
	const selectedAnchor = sessionState?.draft?.path === sessionState?.selectedPath ? sessionState.draft.line ?? null : null;

	function handleStateError(error: unknown) {
		sessionState?.applyConnectionError(error instanceof Error ? error.message : String(error));
	}

	if (bootstrapError) {
		return <div style={{ padding: 24 }}>Unable to start diff review: {bootstrapError}</div>;
	}
	if (!sessionState) {
		return <div style={{ padding: 24 }}>Loading diff review…</div>;
	}

	async function saveDraft() {
		try {
			if (!sessionState.draft) return;
			if (sessionState.draft.kind === "thread") {
				const { thread } = await createThread(
					sessionState.draft.path,
					sessionState.draft.text,
					sessionState.draft.line,
				);
				sessionState.replaceThread(thread);
				sessionState.clearDraft();
				return;
			}
			const { reply } = await createThreadReply(sessionState.draft.threadId, sessionState.draft.text);
			sessionState.applyUserReply({ threadId: sessionState.draft.threadId, reply });
		} catch (error) {
			handleStateError(error);
		}
	}

	return (
		<ReviewLayout
			left={<div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
				<FilterBar showChangedOnly={sessionState.showChangedOnly} onToggle={() => sessionState.setShowChangedOnly(!sessionState.showChangedOnly)} warning={sessionState.getBannerMessage()} />
				<RepoTreePanel paths={visiblePaths} changedFiles={sessionState.changedFiles} selectedPath={sessionState.selectedPath} onSelect={(path) => sessionState.selectPath(path)} />
			</div>}
			center={<div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
				<DiffToolbar
					diffMode={sessionState.diffMode}
					pending={Boolean(sessionState.pendingSubmission)}
					onChangeMode={async (mode) => {
						try {
							const modeState = await setDiffMode(mode);
							const tree = await fetchTree();
							sessionState.diffMode = mode;
							sessionState.requestedMode = modeState.requestedMode;
							sessionState.effectiveMode = modeState.effectiveMode;
							sessionState.mergeBaseWarning = modeState.warning ?? null;
							sessionState.applyTree(tree);
							if (sessionState.selectedPath) {
								setFileDetail(await fetchFile(sessionState.selectedPath));
							} else {
								setFileDetail(null);
							}
						} catch (error) {
							handleStateError(error);
						}
					}}
					onSubmitReview={async () => {
						try {
							await submitReview();
						} catch (error) {
							handleStateError(error);
						}
					}}
				/>
				<DiffViewer
					detail={fileDetail}
					loading={fileLoading}
					error={fileError}
					selectedAnchor={selectedAnchor}
					onSelectAnchor={(anchor) => {
						if (anchor) {
							sessionState.startLineDraft(anchor);
						}
					}}
				/>
			</div>}
			right={<CommentSidebar
				threads={sessionState.getThreadsForSelectedPath()}
				draft={sessionState.draft}
				pending={Boolean(sessionState.pendingSubmission)}
				onStartFileComment={() => {
					const path = sessionState.selectedPath ?? sessionState.paths[0] ?? "";
					if (!path) return;
					sessionState.startFileDraft(path);
				}}
				onDraftChange={(text) => sessionState.updateDraftText(text)}
				onSaveDraft={saveDraft}
				onCancelDraft={() => sessionState.clearDraft()}
				onStartReply={(threadId) => sessionState.startReplyDraft(threadId)}
				onToggleThreadCollapsed={(threadId) => sessionState.toggleThreadCollapsed(threadId)}
				isThreadCollapsed={(threadId) => sessionState.isThreadCollapsed(threadId)}
			/>}
		/>
	);
}
