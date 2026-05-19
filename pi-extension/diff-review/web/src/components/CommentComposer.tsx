import type { DraftComment } from "../types.ts";
import { formatDraftLabel, getComposerIdleActions } from "../ui.ts";

export function CommentComposer({
	draft,
	onStartFileComment,
	onChange,
	onSave,
	onCancel,
}: {
	draft: DraftComment | null;
	onStartFileComment(): void;
	onChange(text: string): void;
	onSave(): void;
	onCancel(): void;
}) {
	const isThreadDraft = draft?.kind === "thread";
	return (
		<div style={{ padding: 12, borderBottom: "1px solid #1e293b", display: "grid", gap: 8, background: "#0f172a" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<strong style={{ color: "#f8fafc" }}>Comment composer</strong>
				{!draft ? (
					<button onClick={onStartFileComment}>{getComposerIdleActions()[0]}</button>
				) : (
					<button onClick={onCancel}>Cancel</button>
				)}
			</div>
			{!draft ? (
				<div style={{ color: "#94a3b8", fontSize: 12 }}>
					Use <strong>File comment</strong> for file-level feedback, or click/drag in the diff to draft a line or range comment.
				</div>
			) : isThreadDraft ? (
				<>
					<div style={{ fontSize: 12, color: "#94a3b8" }}>{formatDraftLabel(draft)}</div>
					<textarea rows={4} value={draft.text} onChange={(event) => onChange(event.target.value)} />
					<button onClick={onSave} disabled={!draft.text.trim()}>Add thread</button>
				</>
			) : (
				<div style={{ color: "#94a3b8", fontSize: 12 }}>
					Replying inline below. Finish or cancel that reply to start another draft here.
				</div>
			)}
		</div>
	);
}
