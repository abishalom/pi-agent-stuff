import { File, MultiFileDiff } from "@pierre/diffs/react";
import type { DiffFileDetail } from "../types.ts";

export function PierreDiffView({ detail }: { detail: DiffFileDetail }) {
	if (detail.loadError) return <pre>{detail.loadError.message}</pre>;
	if (detail.isBinary) return <pre>Binary file cannot be rendered.</pre>;
	if (detail.oldContent != null && detail.newContent != null && detail.oldContent !== detail.newContent) {
		return (
			<MultiFileDiff
				oldFile={{ name: detail.previousPath ?? detail.path, contents: detail.oldContent }}
				newFile={{ name: detail.path, contents: detail.newContent }}
				options={{ diffStyle: "split" }}
			/>
		);
	}
	return <File file={{ name: detail.path, contents: detail.currentContent ?? detail.newContent ?? detail.oldContent ?? "" }} />;
}
