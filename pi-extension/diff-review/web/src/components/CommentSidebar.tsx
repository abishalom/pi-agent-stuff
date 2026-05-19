import type { DraftComment, ReviewThread } from "../types.ts";
import { CommentComposer } from "./CommentComposer.tsx";
import { CommentThread } from "./CommentThread.tsx";
import { EmptyState } from "./EmptyState.tsx";

export function CommentSidebar({
	threads,
	draft,
	pending,
	onStartDraft,
	onDraftChange,
	onSaveDraft,
}: {
	threads: ReviewThread[];
	draft: DraftComment | null;
	pending: boolean;
	onStartDraft(): void;
	onDraftChange(text: string): void;
	onSaveDraft(): void;
}) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
			<CommentComposer draft={draft} onStart={onStartDraft} onChange={onDraftChange} onSave={onSaveDraft} />
			<div style={{ padding: 12, overflow: "auto", display: "grid", gap: 12 }}>
				<div style={{ fontSize: 12, color: "#94a3b8" }}>{pending ? "Pi reply pending…" : "Waiting for Pi replies"}</div>
				{threads.length === 0 ? <EmptyState title="No threads for this file" /> : threads.map((thread) => <CommentThread key={thread.id} thread={thread} />)}
			</div>
		</div>
	);
}
