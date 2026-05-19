import type { DiffFileDetail, LineAnchor, ReviewThread } from "../types.ts";
import { PierreDiffView } from "../adapters/pierre-diffs.tsx";
import { EmptyState } from "./EmptyState.tsx";

export function DiffViewer({
	detail,
	loading,
	error,
	threads,
	focusedThreadId,
	selectedAnchor,
	onSelectAnchor,
	onFocusThread,
}: {
	detail: DiffFileDetail | null;
	loading: boolean;
	error?: string | null;
	threads: ReviewThread[];
	focusedThreadId?: string | null;
	selectedAnchor?: LineAnchor | null;
	onSelectAnchor?(anchor: LineAnchor | null): void;
	onFocusThread?(threadId: string): void;
}) {
	if (loading) return <EmptyState title="Loading file…" />;
	if (error) return <EmptyState title="Unable to load file" detail={error} />;
	if (!detail) return <EmptyState title="Select a file" />;
	return (
		<div style={{ overflow: "auto", height: "100%" }}>
			<PierreDiffView
				detail={detail}
				threads={threads}
				focusedThreadId={focusedThreadId}
				selectedAnchor={selectedAnchor}
				onSelectAnchor={onSelectAnchor}
				onFocusThread={onFocusThread}
			/>
		</div>
	);
}
