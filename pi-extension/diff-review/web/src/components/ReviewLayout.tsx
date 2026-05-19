import type { ReactNode } from "react";

export function ReviewLayout({ left, center, right }: { left: ReactNode; center: ReactNode; right: ReactNode }) {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 320px", height: "100vh", background: "#0f172a", color: "#e2e8f0" }}>
			<div style={{ borderRight: "1px solid #1e293b", minWidth: 0 }}>{left}</div>
			<div style={{ borderRight: "1px solid #1e293b", minWidth: 0 }}>{center}</div>
			<div style={{ minWidth: 0 }}>{right}</div>
		</div>
	);
}
