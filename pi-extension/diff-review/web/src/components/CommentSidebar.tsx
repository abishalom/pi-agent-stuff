import type { DraftComment, ReviewThread } from "../types.ts";
import { CommentComposer } from "./CommentComposer.tsx";
import { CommentThread } from "./CommentThread.tsx";
import { EmptyState } from "./EmptyState.tsx";

export function CommentSidebar({
	threads,
	focusedThreadId,
	draft,
	pending,
	onStartFileComment,
	onDraftChange,
	onSaveDraft,
	onCancelDraft,
	onStartReply,
	onToggleThreadCollapsed,
	isThreadCollapsed,
}: {
	threads: ReviewThread[];
	focusedThreadId: string | null;
	draft: DraftComment | null;
	pending: boolean;
	onStartFileComment(): void;
	onDraftChange(text: string): void;
	onSaveDraft(): void;
	onCancelDraft(): void;
	onStartReply(threadId: string): void;
	onToggleThreadCollapsed(threadId: string): void;
	isThreadCollapsed(threadId: string): boolean;
}) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto auto 1fr", height: "100%", background: "#020617" }}>
			<CommentComposer draft={draft} onStartFileComment={onStartFileComment} onChange={onDraftChange} onSave={onSaveDraft} onCancel={onCancelDraft} />
			<div style={{ padding: "10px 12px", borderBottom: "1px solid #1e293b", fontSize: 12, color: "#94a3b8" }}>
				{pending ? "Waiting for Pi to complete this round" : "Ready for more feedback"}
			</div>
			<div style={{ padding: 12, overflow: "auto", display: "grid", gap: 12 }}>
				{threads.length === 0 ? (
					<EmptyState title="No threads for this file" detail="Add a file comment, click the + gutter action for a single-line comment, or drag in the diff to start a range comment." />
				) : (
					threads.map((thread) => {
						const replyDraft = draft?.kind === "reply" && draft.threadId === thread.id ? draft : null;
						return (
							<CommentThread
								key={thread.id}
								thread={thread}
								isFocused={focusedThreadId === thread.id}
								collapsed={isThreadCollapsed(thread.id)}
								replyDraft={replyDraft}
								onToggleCollapsed={() => onToggleThreadCollapsed(thread.id)}
								onStartReply={() => onStartReply(thread.id)}
								onReplyChange={onDraftChange}
								onSaveReply={onSaveDraft}
								onCancelReply={onCancelDraft}
							/>
						);
					})
				)}
			</div>
		</div>
	);
}
