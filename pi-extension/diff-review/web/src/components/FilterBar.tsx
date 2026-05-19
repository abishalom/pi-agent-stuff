import { getButtonStyle } from "../ui.ts";

export function FilterBar({
	showChangedOnly,
	onToggle,
	warning,
}: {
	showChangedOnly: boolean;
	onToggle(): void;
	warning?: string | null;
}) {
	return (
		<div style={{ display: "grid", gap: 8, padding: 12, borderBottom: "1px solid #1e293b" }}>
			<button onClick={onToggle} style={{ ...getButtonStyle("secondary"), justifyContent: "flex-start", textAlign: "left", width: "100%" }}>
				{showChangedOnly ? "Showing changed files" : "Showing full repo"}
			</button>
			{warning ? <div style={{ color: "#fbbf24", fontSize: 12 }}>{warning}</div> : null}
		</div>
	);
}
