import type { SelectedLineRange } from "@pierre/diffs";
import type { LineAnchor } from "../types.ts";

export function selectionRangeToAnchor(path: string, range: SelectedLineRange | null, fallbackTargetSide: LineAnchor["targetSide"] = "new"): LineAnchor | null {
	if (!range) return null;
	const startLine = Math.min(range.start, range.end);
	const endLine = Math.max(range.start, range.end);
	const selectedSide = range.side ?? range.endSide;
	const targetSide = selectedSide === "deletions"
		? "old"
		: selectedSide === "additions"
			? "new"
			: fallbackTargetSide;
	return { path, startLine, endLine, targetSide };
}

export function anchorToSelectedLines(anchor: LineAnchor | null | undefined): SelectedLineRange | null {
	if (!anchor) return null;
	const side = anchor.targetSide === "old" ? "deletions" : "additions";
	return {
		start: anchor.startLine,
		end: anchor.endLine,
		side,
		endSide: side,
	};
}
