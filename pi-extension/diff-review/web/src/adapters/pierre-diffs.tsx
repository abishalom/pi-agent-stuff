import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffFileDetail, LineAnchor, ReviewThread } from "../types.ts";
import { getGutterCommentLabel } from "../ui.ts";
import type { AnnotationMetadata } from "./diff-review-annotations.ts";
import { buildDiffLineAnnotations, buildFileLineAnnotations } from "./diff-review-annotations.ts";
import { anchorToSelectedLines, hoveredLineToAnchor, selectionRangeToAnchor } from "./pierre-diffs.ts";

function renderAnnotationButton(
	annotation: { lineNumber: number; metadata: AnnotationMetadata },
	focusedThreadId: string | null | undefined,
	onFocusThread?: (threadId: string) => void,
) {
	const isFocused = annotation.metadata.threadIds.includes(focusedThreadId ?? "");
	return (
		<button
			type="button"
			onClick={() => onFocusThread?.(annotation.metadata.threadIds[0])}
			aria-label={`Open ${annotation.metadata.count} thread(s) on line ${annotation.lineNumber}`}
			style={{
				borderRadius: 999,
				padding: "0 6px",
				background: isFocused ? "#2563eb" : "#1e293b",
				color: "#f8fafc",
				border: "1px solid #334155",
				fontSize: 12,
				lineHeight: "20px",
				minWidth: 24,
			}}
		>
			{annotation.metadata.count}
		</button>
	);
}

function renderGutterButton(anchor: LineAnchor | null, onSelectAnchor?: (anchor: LineAnchor | null) => void) {
	if (!anchor) return null;
	return (
		<button
			type="button"
			onClick={() => onSelectAnchor?.(anchor)}
			aria-label={`Add comment on ${anchor.path}:${anchor.startLine}`}
			style={{
				width: 22,
				height: 22,
				borderRadius: 999,
				border: "1px solid #334155",
				background: "#0f172a",
				color: "#f8fafc",
				fontWeight: 700,
			}}
		>
			{getGutterCommentLabel()}
		</button>
	);
}

export function PierreDiffView({
	detail,
	threads,
	focusedThreadId,
	selectedAnchor,
	onSelectAnchor,
	onFocusThread,
}: {
	detail: DiffFileDetail;
	threads: ReviewThread[];
	focusedThreadId?: string | null;
	selectedAnchor?: LineAnchor | null;
	onSelectAnchor?(anchor: LineAnchor | null): void;
	onFocusThread?(threadId: string): void;
}) {
	if (detail.loadError) return <pre>{detail.loadError.message}</pre>;
	if (detail.isBinary) return <pre>Binary file cannot be rendered.</pre>;
	const selectedLines = selectedAnchor?.path === detail.path ? anchorToSelectedLines(selectedAnchor) : null;
	const fileThreads = threads.filter((thread) => thread.path === detail.path && thread.root.line);
	if (detail.oldContent != null && detail.newContent != null && detail.oldContent !== detail.newContent) {
		const deletionAnnotations = buildDiffLineAnnotations(fileThreads, "old");
		const additionAnnotations = buildDiffLineAnnotations(fileThreads, "new");
		return (
			<MultiFileDiff
				oldFile={{ name: detail.previousPath ?? detail.path, contents: detail.oldContent }}
				newFile={{ name: detail.path, contents: detail.newContent }}
				selectedLines={selectedLines}
				lineAnnotations={[...deletionAnnotations, ...additionAnnotations]}
				renderAnnotation={(annotation) => renderAnnotationButton(annotation, focusedThreadId, onFocusThread)}
				renderGutterUtility={(getHoveredLine) => renderGutterButton(hoveredLineToAnchor(detail.path, getHoveredLine()), onSelectAnchor)}
				options={{
					diffStyle: "split",
					enableLineSelection: true,
					enableGutterUtility: true,
					onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range)),
				}}
			/>
		);
	}
	const fileAnnotations = buildFileLineAnnotations(fileThreads);
	return (
		<File
			file={{ name: detail.path, contents: detail.currentContent ?? detail.newContent ?? detail.oldContent ?? "" }}
			selectedLines={selectedLines}
			lineAnnotations={fileAnnotations}
			renderAnnotation={(annotation) => renderAnnotationButton(annotation, focusedThreadId, onFocusThread)}
			renderGutterUtility={(getHoveredLine) => renderGutterButton(hoveredLineToAnchor(detail.path, getHoveredLine(), "new"), onSelectAnchor)}
			options={{
				enableLineSelection: true,
				enableGutterUtility: true,
				onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range, "new")),
			}}
		/>
	);
}
