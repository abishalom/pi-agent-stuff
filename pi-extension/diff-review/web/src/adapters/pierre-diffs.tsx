import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { LineAnchor, DiffFileDetail } from "../types.ts";
import { anchorToSelectedLines, selectionRangeToAnchor } from "./pierre-diffs.ts";

export function PierreDiffView({
	detail,
	selectedAnchor,
	onSelectAnchor,
}: {
	detail: DiffFileDetail;
	selectedAnchor?: LineAnchor | null;
	onSelectAnchor?(anchor: LineAnchor | null): void;
}) {
	if (detail.loadError) return <pre>{detail.loadError.message}</pre>;
	if (detail.isBinary) return <pre>Binary file cannot be rendered.</pre>;
	const selectedLines = selectedAnchor?.path === detail.path ? anchorToSelectedLines(selectedAnchor) : null;
	if (detail.oldContent != null && detail.newContent != null && detail.oldContent !== detail.newContent) {
		return (
			<MultiFileDiff
				oldFile={{ name: detail.previousPath ?? detail.path, contents: detail.oldContent }}
				newFile={{ name: detail.path, contents: detail.newContent }}
				selectedLines={selectedLines}
				options={{
					diffStyle: "split",
					enableLineSelection: true,
					onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range)),
				}}
			/>
		);
	}
	return (
		<File
			file={{ name: detail.path, contents: detail.currentContent ?? detail.newContent ?? detail.oldContent ?? "" }}
			selectedLines={selectedLines}
			options={{
				enableLineSelection: true,
				onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range, "new")),
			}}
		/>
	);
}
