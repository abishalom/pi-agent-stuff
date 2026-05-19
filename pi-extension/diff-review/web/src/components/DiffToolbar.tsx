import type { DiffMode } from "../types.ts";
import { getSubmitButtonLabel } from "../ui.ts";

export function DiffToolbar({
	diffMode,
	pending,
	onChangeMode,
	onSubmitReview,
}: {
	diffMode: DiffMode;
	pending: boolean;
	onChangeMode(mode: DiffMode): void;
	onSubmitReview(): void;
}) {
	return (
		<div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderBottom: "1px solid #1e293b", background: "#0f172a" }}>
			<label style={{ display: "flex", gap: 8, alignItems: "center", color: "#cbd5e1" }}>
				<span>Diff mode</span>
				<select value={diffMode} onChange={(event) => onChangeMode(event.target.value as DiffMode)}>
					<option value="working-tree-vs-head">working tree vs HEAD</option>
					<option value="merge-base-vs-head">merge base vs HEAD</option>
				</select>
			</label>
			<div style={{ flex: 1 }} />
			<button
				onClick={onSubmitReview}
				disabled={pending}
				style={{
					padding: "8px 12px",
					borderRadius: 8,
					border: "1px solid #334155",
					background: pending ? "#1e293b" : "#2563eb",
					color: "#f8fafc",
				}}
			>
				{getSubmitButtonLabel(pending)}
			</button>
		</div>
	);
}
