import type { DraftComment } from "../types.ts";
import { formatDraftLabel, getButtonStyle, getComposerIdleActions, getComposerKeyAction, getComposerShortcutHint, getDraftComposerPlacement, getGutterCommentLabel, getTextFieldStyle } from "../ui.ts";

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
	const placement = getDraftComposerPlacement(draft);
	const shortcutHint = getComposerShortcutHint();
	return (
		<div style={{ padding: 12, borderBottom: "1px solid #1e293b", display: "grid", gap: 8, background: "#0f172a" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<strong style={{ color: "#f8fafc" }}>Comment composer</strong>
				{!draft ? (
					<button onClick={onStartFileComment} style={getButtonStyle("secondary")}>{getComposerIdleActions()[0]}</button>
				) : (
					<button onClick={onCancel} style={getButtonStyle("ghost")}>Cancel</button>
				)}
			</div>
			{!draft ? (
				<div style={{ color: "#94a3b8", fontSize: 12 }}>
					Use <strong>File comment</strong> for file-level feedback, click <strong>{getGutterCommentLabel()}</strong> in the gutter for a single-line comment, or drag in the diff to draft a range comment.
				</div>
			) : isThreadDraft && placement === "sidebar" ? (
				<>
					<div style={{ fontSize: 12, color: "#94a3b8" }}>{formatDraftLabel(draft)}</div>
					<textarea
						rows={4}
						value={draft.text}
						onChange={(event) => onChange(event.target.value)}
						onKeyDown={(event) => {
							const action = getComposerKeyAction(event);
							if (!action) return;
							event.preventDefault();
							if (action === "cancel") {
								onCancel();
								return;
							}
							if (draft.text.trim()) onSave();
						}}
						style={getTextFieldStyle({ minHeight: 104 })}
					/>
					<div style={{ fontSize: 12, color: "#64748b" }}>{shortcutHint}</div>
					<button onClick={onSave} disabled={!draft.text.trim()} style={getButtonStyle("primary", { disabled: !draft.text.trim() })}>Add thread</button>
				</>
			) : isThreadDraft ? (
				<div style={{ color: "#94a3b8", fontSize: 12 }}>
					Drafting <strong>{formatDraftLabel(draft)}</strong> in the floating comment window over the diff.
				</div>
			) : (
				<div style={{ color: "#94a3b8", fontSize: 12 }}>
					Replying inline below. Finish or cancel that reply to start another draft here.
				</div>
			)}
		</div>
	);
}
