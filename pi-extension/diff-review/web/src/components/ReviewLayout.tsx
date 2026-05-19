import type { ReactNode } from "react";
import { getReviewColumnStyle } from "../ui.ts";

export function ReviewLayout({ left, center, right }: { left: ReactNode; center: ReactNode; right: ReactNode }) {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 320px", height: "100vh", overflow: "hidden", background: "#0f172a", color: "#e2e8f0" }}>
			<div style={{ ...getReviewColumnStyle(), borderRight: "1px solid #1e293b" }}>{left}</div>
			<div style={{ ...getReviewColumnStyle(), borderRight: "1px solid #1e293b" }}>{center}</div>
			<div style={getReviewColumnStyle()}>{right}</div>
		</div>
	);
}
