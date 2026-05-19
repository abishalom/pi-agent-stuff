import type { ReviewThread } from "../types.ts";

export function CommentThread({ thread }: { thread: ReviewThread }) {
	return (
		<div style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
			<div>
				<div style={{ fontSize: 12, color: "#94a3b8" }}>{thread.path}</div>
				<div>{thread.root.body}</div>
			</div>
			{thread.replies.map((reply) => <div key={reply.id} style={{ marginLeft: 12, color: "#cbd5e1" }}>Pi: {reply.reply}</div>)}
		</div>
	);
}
