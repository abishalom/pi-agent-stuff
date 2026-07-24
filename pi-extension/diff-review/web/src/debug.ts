export type TreeReloadDebugSignal = {
	sequence: number;
	reason: string;
	detail?: Record<string, unknown>;
};

type DiffReviewTreeDebugEntry = {
	index: number;
	at: string;
	event: string;
	data?: unknown;
};

declare global {
	interface Window {
		__DIFF_REVIEW_TREE_DEBUG__?: DiffReviewTreeDebugEntry[];
	}
}

let nextDebugEntryIndex = 1;

export function logDiffReviewTreeDebug(event: string, data?: unknown) {
	if (typeof window === "undefined") return;
	const entry: DiffReviewTreeDebugEntry = {
		index: nextDebugEntryIndex++,
		at: new Date().toISOString(),
		event,
		data,
	};
	const log = window.__DIFF_REVIEW_TREE_DEBUG__ ?? (window.__DIFF_REVIEW_TREE_DEBUG__ = []);
	log.push(entry);
	if (log.length > 500) {
		log.splice(0, log.length - 500);
	}
	console.info(`[diff-review/tree] ${event}`, data);
}
