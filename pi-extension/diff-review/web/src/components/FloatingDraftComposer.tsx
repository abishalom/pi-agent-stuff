import { useEffect, useRef } from "react";
import type { DraftComment } from "../types.ts";
import { formatDraftLabel, getButtonStyle, getComposerKeyAction, getComposerShortcutHint, getDraftComposerPlacement, getTextFieldStyle } from "../ui.ts";

export function FloatingDraftComposer({
	draft,
	onChange,
	onSave,
	onCancel,
}: {
	draft: DraftComment | null;
	onChange(text: string): void;
	onSave(): void;
	onCancel(): void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isVisible = getDraftComposerPlacement(draft) === "floating";
	const shortcutHint = getComposerShortcutHint();

	useEffect(() => {
		if (!isVisible) return;
		textareaRef.current?.focus();
	}, [isVisible, draft?.id]);

	if (!isVisible || !draft || draft.kind !== "thread" || !draft.line) return null;

	return (
		<div
			style={{
				position: "absolute",
				right: 16,
				bottom: 16,
				width: 320,
				maxWidth: "calc(100% - 32px)",
				border: "1px solid #334155",
				borderRadius: 14,
				background: "rgba(2, 6, 23, 0.96)",
				boxShadow: "0 20px 48px rgba(15, 23, 42, 0.45)",
				padding: 12,
				display: "grid",
				gap: 8,
				zIndex: 20,
			}}
		>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
				<strong style={{ color: "#f8fafc", fontSize: 13 }}>New comment</strong>
				<button onClick={onCancel} style={getButtonStyle("ghost", { compact: true })}>Cancel</button>
			</div>
			<div style={{ fontSize: 12, color: "#94a3b8" }}>{formatDraftLabel(draft)}</div>
			<textarea
				ref={textareaRef}
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
				style={getTextFieldStyle({ minHeight: 108 })}
			/>
			<div style={{ fontSize: 12, color: "#64748b" }}>{shortcutHint}</div>
			<button onClick={onSave} disabled={!draft.text.trim()} style={getButtonStyle("primary", { disabled: !draft.text.trim() })}>Add thread</button>
		</div>
	);
}
