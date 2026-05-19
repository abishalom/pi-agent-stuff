import type { DiffMode } from "../types.ts";

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
		<div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderBottom: "1px solid #1e293b" }}>
			<label>
				Diff mode{" "}
				<select value={diffMode} onChange={(event) => onChangeMode(event.target.value as DiffMode)}>
					<option value="working-tree-vs-head">working tree vs HEAD</option>
					<option value="merge-base-vs-head">merge base vs HEAD</option>
				</select>
			</label>
			<button onClick={onSubmitReview} disabled={pending}>{pending ? "Waiting for Pi…" : "Request Pi review"}</button>
		</div>
	);
}
