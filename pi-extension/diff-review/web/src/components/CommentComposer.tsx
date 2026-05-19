import type { DraftComment } from "../types.ts";

export function CommentComposer({
	draft,
	onStart,
	onChange,
	onSave,
}: {
	draft: DraftComment | null;
	onStart(): void;
	onChange(text: string): void;
	onSave(): void;
}) {
	return (
		<div style={{ padding: 12, borderBottom: "1px solid #1e293b", display: "grid", gap: 8 }}>
			<div style={{ display: "flex", justifyContent: "space-between" }}>
				<strong>Comment composer</strong>
				{draft ? null : <button onClick={onStart}>New comment</button>}
			</div>
			{draft ? (
				<>
					<div style={{ fontSize: 12, color: "#94a3b8" }}>{draft.anchor.path}:{draft.anchor.startLine}</div>
					<textarea rows={4} value={draft.text} onChange={(event) => onChange(event.target.value)} />
					<button onClick={onSave} disabled={!draft.text.trim()}>Add thread</button>
				</>
			) : <div style={{ color: "#94a3b8", fontSize: 12 }}>Draft a file or line comment for the selected path.</div>}
		</div>
	);
}
