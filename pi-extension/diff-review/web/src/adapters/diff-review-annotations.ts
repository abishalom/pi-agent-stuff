import type { DiffLineAnnotation, LineAnnotation } from "@pierre/diffs";
import type { ReviewThread } from "../types.ts";

export type AnnotationMetadata = {
	threadIds: string[];
	count: number;
};

function appendThreadToBucket(
	buckets: Map<number, AnnotationMetadata>,
	threadId: string,
	startLine: number,
	endLine: number,
) {
	for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
		const existing = buckets.get(lineNumber) ?? { threadIds: [], count: 0 };
		existing.threadIds.push(threadId);
		existing.count += 1;
		buckets.set(lineNumber, existing);
	}
}

export function buildDiffLineAnnotations(
	threads: ReviewThread[],
	targetSide: "old" | "new",
): DiffLineAnnotation<AnnotationMetadata>[] {
	const buckets = new Map<number, AnnotationMetadata>();
	for (const thread of threads) {
		const line = thread.root.line;
		if (!line || line.targetSide !== targetSide) continue;
		appendThreadToBucket(buckets, thread.id, line.startLine, line.endLine);
	}
	const side = targetSide === "old" ? "deletions" : "additions";
	return [...buckets.entries()]
		.sort(([left], [right]) => left - right)
		.map(([lineNumber, metadata]) => ({ lineNumber, side, metadata }));
}

export function buildFileLineAnnotations(threads: ReviewThread[]): LineAnnotation<AnnotationMetadata>[] {
	const buckets = new Map<number, AnnotationMetadata>();
	for (const thread of threads) {
		const line = thread.root.line;
		if (!line) continue;
		appendThreadToBucket(buckets, thread.id, line.startLine, line.endLine);
	}
	return [...buckets.entries()]
		.sort(([left], [right]) => left - right)
		.map(([lineNumber, metadata]) => ({ lineNumber, metadata }));
}
