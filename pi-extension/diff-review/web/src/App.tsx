import { useEffect, useMemo, useState } from "react";
import { connectEvents, fetchFile, fetchSession, setDiffMode, submitReview } from "./api.ts";
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
		(async () => {
			try {
				const payload: BootstrapPayload = await fetchSession();
				if (!active) return;
				const state = createReviewSessionState(payload);
				state.applyBootstrap(payload);
				setSessionState(state);
				const unsubscribe = state.subscribe(() => rerender((value) => value + 1));
				source = connectEvents({
					onSessionState: (event) => state.applySessionState(event),
					onReply: (event) => state.applyReply(event),
					onSessionClosed: (event) => state.applySessionClosed(event),
					onError: (message) => state.applyConnectionError(message),
				});
				return () => unsubscribe();
			} catch (error) {
				if (!active) return;
				setBootstrapError(error instanceof Error ? error.message : String(error));
			}
		})();
		return () => {
			active = false;
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

	if (bootstrapError) {
		return <div style={{ padding: 24 }}>Unable to start diff review: {bootstrapError}</div>;
	}
	if (!sessionState) {
		return <div style={{ padding: 24 }}>Loading diff review…</div>;
	}

	return (
		<ReviewLayout
			left={<div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
				<FilterBar showChangedOnly={sessionState.showChangedOnly} onToggle={() => sessionState.setShowChangedOnly(!sessionState.showChangedOnly)} warning={sessionState.mergeBaseWarning ?? sessionState.errorMessage} />
				<RepoTreePanel paths={visiblePaths} changedFiles={sessionState.changedFiles} selectedPath={sessionState.selectedPath} onSelect={(path) => sessionState.selectPath(path)} />
			</div>}
			center={<div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
				<DiffToolbar
					diffMode={sessionState.diffMode}
					pending={Boolean(sessionState.pendingSubmission)}
					onChangeMode={async (mode) => {
						try {
							const modeState = await setDiffMode(mode);
							sessionState.diffMode = mode;
							sessionState.requestedMode = modeState.requestedMode;
							sessionState.effectiveMode = modeState.effectiveMode;
							sessionState.mergeBaseWarning = modeState.warning ?? null;
							sessionState.emit();
							if (sessionState.selectedPath) setFileDetail(await fetchFile(sessionState.selectedPath));
						} catch (error) {
							sessionState.applyConnectionError(error instanceof Error ? error.message : String(error));
						}
					}}
					onSubmitReview={async () => {
						try {
							await submitReview();
						} catch (error) {
							sessionState.applyConnectionError(error instanceof Error ? error.message : String(error));
						}
					}}
				/>
				<DiffViewer detail={fileDetail} loading={fileLoading} error={fileError} />
			</div>}
			right={<CommentSidebar
				threads={sessionState.getThreadsForSelectedPath()}
				draft={sessionState.draft}
				pending={Boolean(sessionState.pendingSubmission)}
				onStartDraft={() => sessionState.startDraft({ path: sessionState.selectedPath ?? sessionState.paths[0] ?? "", startLine: 1, endLine: 1, targetSide: "new" })}
				onDraftChange={(text) => sessionState.updateDraftText(text)}
				onSaveDraft={() => sessionState.commitDraftToThread()}
			/>}
		/>
	);
}
