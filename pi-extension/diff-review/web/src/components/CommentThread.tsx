import type { DraftComment, ReviewThread } from "../types.ts";
import { buildThreadTimeline, formatAnchor, formatDraftLabel } from "../ui.ts";

function truncate(text: string, maxLength = 72) {
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function CommentThread({
	thread,
	collapsed,
	replyDraft,
	onToggleCollapsed,
	onStartReply,
	onReplyChange,
	onSaveReply,
	onCancelReply,
}: {
	thread: ReviewThread;
	collapsed: boolean;
	replyDraft: DraftComment | null;
	onToggleCollapsed(): void;
	onStartReply(): void;
	onReplyChange(text: string): void;
	onSaveReply(): void;
	onCancelReply(): void;
}) {
	const timeline = buildThreadTimeline(thread);
	const anchor = formatAnchor(thread.root.line);
	const summary = truncate(thread.root.body.replace(/\s+/g, " "));
	return (
		<div style={{ border: "1px solid #1e293b", borderRadius: 10, padding: 12, display: "grid", gap: 10, background: "#111827" }}>
			<div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "start", gap: 10 }}>
				<button onClick={onToggleCollapsed} aria-label={collapsed ? "Expand thread" : "Collapse thread"} style={{ width: 24, height: 24 }}>
					{collapsed ? "+" : "-"}
				</button>
				<div style={{ minWidth: 0 }}>
					<div style={{ fontSize: 12, color: "#94a3b8" }}>{thread.path}{anchor ? `:${anchor}` : ""}</div>
					{collapsed ? <div style={{ color: "#e2e8f0" }}>{summary}</div> : null}
				</div>
				{!replyDraft ? <button onClick={onStartReply}>Reply</button> : <button onClick={onCancelReply}>Cancel</button>}
			</div>
			{collapsed ? (
				<div style={{ fontSize: 12, color: "#64748b" }}>{timeline.length - 1} repl{timeline.length - 1 === 1 ? "y" : "ies"}</div>
			) : (
				<>
					<div style={{ display: "grid", gap: 8 }}>
						{timeline.map((entry) => (
							<div key={entry.id} style={{ padding: 10, borderRadius: 8, background: entry.author === "Pi" ? "#172554" : "#0f172a" }}>
								<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
									<strong style={{ color: "#f8fafc" }}>{entry.author}</strong>
									{entry.line ? <span style={{ color: "#94a3b8", fontSize: 12 }}>{thread.path}:{formatAnchor(entry.line)}</span> : null}
								</div>
								<div style={{ color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{entry.text}</div>
							</div>
						))}
					</div>
					{replyDraft?.kind === "reply" ? (
						<div style={{ display: "grid", gap: 8, paddingTop: 4 }}>
							<div style={{ fontSize: 12, color: "#94a3b8" }}>{formatDraftLabel(replyDraft)}</div>
							<textarea rows={3} value={replyDraft.text} onChange={(event) => onReplyChange(event.target.value)} />
							<button onClick={onSaveReply} disabled={!replyDraft.text.trim()}>Add reply</button>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
