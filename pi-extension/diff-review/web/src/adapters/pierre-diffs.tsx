import { memo, useCallback, useMemo } from "react";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffFileDetail, LineAnchor, ReviewThread } from "../types.ts";
import { getButtonStyle, getGutterCommentLabel } from "../ui.ts";
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
				...getButtonStyle(isFocused ? "primary" : "secondary", { compact: true }),
				borderRadius: 999,
				fontSize: 12,
				height: 24,
				minWidth: 24,
				padding: "0 6px",
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
				...getButtonStyle("secondary", { compact: true }),
				width: 24,
				height: 24,
				borderRadius: 999,
				fontWeight: 700,
				padding: 0,
			}}
		>
			{getGutterCommentLabel()}
		</button>
	);
}

export const PierreDiffView = memo(function PierreDiffView({
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
	const selectedLines = useMemo(
		() => selectedAnchor?.path === detail.path ? anchorToSelectedLines(selectedAnchor) : null,
		[detail.path, selectedAnchor],
	);
	const fileThreads = useMemo(
		() => threads.filter((thread) => thread.path === detail.path && thread.root.line),
		[detail.path, threads],
	);
	const renderAnnotation = useCallback(
		(annotation: { lineNumber: number; metadata: AnnotationMetadata }) => renderAnnotationButton(annotation, focusedThreadId, onFocusThread),
		[focusedThreadId, onFocusThread],
	);
	const renderDiffGutterUtility = useCallback(
		(getHoveredLine: () => Parameters<typeof hoveredLineToAnchor>[1]) => renderGutterButton(hoveredLineToAnchor(detail.path, getHoveredLine()), onSelectAnchor),
		[detail.path, onSelectAnchor],
	);
	const renderFileGutterUtility = useCallback(
		(getHoveredLine: () => Parameters<typeof hoveredLineToAnchor>[1]) => renderGutterButton(hoveredLineToAnchor(detail.path, getHoveredLine(), "new"), onSelectAnchor),
		[detail.path, onSelectAnchor],
	);
	const handleDiffLineSelected = useCallback(
		(range: Parameters<typeof selectionRangeToAnchor>[1]) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range)),
		[detail.path, onSelectAnchor],
	);
	const handleFileLineSelected = useCallback(
		(range: Parameters<typeof selectionRangeToAnchor>[1]) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range, "new")),
		[detail.path, onSelectAnchor],
	);
	const oldFile = useMemo(
		() => detail.oldContent == null ? null : { name: detail.previousPath ?? detail.path, contents: detail.oldContent },
		[detail.oldContent, detail.path, detail.previousPath],
	);
	const newFile = useMemo(
		() => detail.newContent == null ? null : { name: detail.path, contents: detail.newContent },
		[detail.newContent, detail.path],
	);
	const file = useMemo(
		() => ({ name: detail.path, contents: detail.currentContent ?? detail.newContent ?? detail.oldContent ?? "" }),
		[detail.currentContent, detail.newContent, detail.oldContent, detail.path],
	);
	const diffLineAnnotations = useMemo(
		() => [...buildDiffLineAnnotations(fileThreads, "old"), ...buildDiffLineAnnotations(fileThreads, "new")],
		[fileThreads],
	);
	const fileAnnotations = useMemo(() => buildFileLineAnnotations(fileThreads), [fileThreads]);
	const diffOptions = useMemo(() => ({
		diffStyle: "split" as const,
		enableLineSelection: true,
		enableGutterUtility: true,
		onLineSelected: handleDiffLineSelected,
	}), [handleDiffLineSelected]);
	const fileOptions = useMemo(() => ({
		enableLineSelection: true,
		enableGutterUtility: true,
		onLineSelected: handleFileLineSelected,
	}), [handleFileLineSelected]);

	if (detail.loadError) return <pre>{detail.loadError.message}</pre>;
	if (detail.isBinary) return <pre>Binary file cannot be rendered.</pre>;
	if (detail.oldContent != null && detail.newContent != null && detail.oldContent !== detail.newContent && oldFile && newFile) {
		return (
			<MultiFileDiff
				oldFile={oldFile}
				newFile={newFile}
				selectedLines={selectedLines}
				lineAnnotations={diffLineAnnotations}
				renderAnnotation={renderAnnotation}
				renderGutterUtility={renderDiffGutterUtility}
				options={diffOptions}
			/>
		);
	}
	return (
		<File
			file={file}
			selectedLines={selectedLines}
			lineAnnotations={fileAnnotations}
			renderAnnotation={renderAnnotation}
			renderGutterUtility={renderFileGutterUtility}
			options={fileOptions}
		/>
	);
});
