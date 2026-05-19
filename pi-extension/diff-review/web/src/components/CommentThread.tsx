import { useEffect, useRef } from "react";
import type { DraftComment, ReviewThread } from "../types.ts";
import { buildThreadTimeline, formatAnchor, formatDraftLabel, getButtonStyle, getComposerKeyAction, getComposerShortcutHint, getTextFieldStyle, getThreadCardLayout } from "../ui.ts";

function truncate(text: string, maxLength = 72) {
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function CommentThread({
	thread,
	isFocused,
	collapsed,
	replyDraft,
	onFocusThread,
	onToggleCollapsed,
	onStartReply,
	onReplyChange,
	onSaveReply,
	onCancelReply,
}: {
	thread: ReviewThread;
	isFocused: boolean;
	collapsed: boolean;
	replyDraft: DraftComment | null;
	onFocusThread(): void;
	onToggleCollapsed(): void;
	onStartReply(): void;
	onReplyChange(text: string): void;
	onSaveReply(): void;
	onCancelReply(): void;
}) {
	const timeline = buildThreadTimeline(thread);
	const anchor = formatAnchor(thread.root.line);
	const summary = truncate(thread.root.body.replace(/\s+/g, " "));
	const replyCount = timeline.length - 1;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const layout = getThreadCardLayout(collapsed, isFocused);
	const shortcutHint = getComposerShortcutHint();

	useEffect(() => {
		if (!isFocused) return;
		containerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [isFocused]);

	return (
		<div
			ref={containerRef}
			role="button"
			tabIndex={0}
			aria-pressed={isFocused}
			onClick={onFocusThread}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onFocusThread();
			}}
			style={{
				border: `1px solid ${layout.borderColor}`,
				borderRadius: 10,
				padding: layout.padding,
				display: "grid",
				gap: layout.gap,
				height: layout.height,
				overflow: layout.overflow,
				background: layout.background,
				boxShadow: layout.boxShadow,
				cursor: "pointer",
			}}
		>
			<div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: collapsed ? "center" : "start", gap: layout.headerGap }}>
				<button
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapsed();
					}}
					aria-label={collapsed ? "Expand thread" : "Collapse thread"}
					style={{
						...getButtonStyle("secondary", { compact: true }),
						width: layout.toggleButtonSize,
						height: layout.toggleButtonSize,
						padding: 0,
						fontSize: 18,
						fontWeight: 700,
					}}
				>
					{collapsed ? "+" : "-"}
				</button>
				<div style={{ minWidth: 0, display: "grid", gap: collapsed ? 4 : 6 }}>
					<div style={{ fontSize: 12, color: "#94a3b8" }}>{thread.path}{anchor ? `:${anchor}` : ""}</div>
					{layout.showCollapsedSummary ? (
						<div
							style={{
								color: "#e2e8f0",
								fontSize: 13,
								lineHeight: 1.35,
								overflow: "hidden",
								display: "-webkit-box",
								WebkitBoxOrient: "vertical",
								WebkitLineClamp: layout.summaryLineClamp,
							}}
						>
							{summary}
						</div>
					) : null}
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					{collapsed ? (
						<span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
							{replyCount} repl{replyCount === 1 ? "y" : "ies"}
						</span>
					) : null}
					{!replyDraft ? (
						<button
							onClick={(event) => {
								event.stopPropagation();
								onStartReply();
							}}
							style={getButtonStyle("secondary", { compact: true })}
						>
							Reply
						</button>
					) : (
						<button
							onClick={(event) => {
								event.stopPropagation();
								onCancelReply();
							}}
							style={getButtonStyle("ghost", { compact: true })}
						>
							Cancel
						</button>
					)}
				</div>
			</div>
			{collapsed ? null : (
				<>
					<div style={{ display: "grid", gap: 8 }}>
						{timeline.map((entry) => (
							<div key={entry.id} style={{ padding: 10, borderRadius: 8, background: entry.author === "Pi" ? "#1d4ed8" : "#0f172a" }}>
								<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
									<strong style={{ color: "#f8fafc" }}>{entry.author}</strong>
									{entry.line ? <span style={{ color: "#94a3b8", fontSize: 12 }}>{thread.path}:{formatAnchor(entry.line)}</span> : null}
								</div>
								<div style={{ color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{entry.text}</div>
							</div>
						))}
					</div>
					{replyDraft?.kind === "reply" ? (
						<div style={{ display: "grid", gap: 8, paddingTop: 4 }} onClick={(event) => event.stopPropagation()}>
							<div style={{ fontSize: 12, color: "#94a3b8" }}>{formatDraftLabel(replyDraft)}</div>
							<textarea
								rows={3}
								value={replyDraft.text}
								onChange={(event) => onReplyChange(event.target.value)}
								onKeyDown={(event) => {
									const action = getComposerKeyAction(event);
									if (!action) return;
									event.preventDefault();
									if (action === "cancel") {
										onCancelReply();
										return;
									}
									if (replyDraft.text.trim()) onSaveReply();
								}}
								style={getTextFieldStyle({ minHeight: 88 })}
							/>
							<div style={{ fontSize: 12, color: "#64748b" }}>{shortcutHint}</div>
							<button onClick={onSaveReply} disabled={!replyDraft.text.trim()} style={getButtonStyle("primary", { disabled: !replyDraft.text.trim() })}>Add reply</button>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
