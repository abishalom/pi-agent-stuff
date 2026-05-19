import { memo, useEffect, useRef } from "react";
import type { DiffFileDetail, LineAnchor, ReviewThread } from "../types.ts";
import { PierreDiffView } from "../adapters/pierre-diffs.tsx";
import { getAnchorScrollKey, getPaneScrollAreaStyle } from "../ui.ts";
import { EmptyState } from "./EmptyState.tsx";

function findSelectedLineElement(root: ParentNode | null): HTMLElement | null {
	if (!root) return null;
	if (root instanceof Element) {
		const selected = root.querySelector<HTMLElement>("[data-selected-line]");
		if (selected) return selected;
	}
	const elements = root.querySelectorAll?.("*") ?? [];
	for (const candidate of elements) {
		if (!(candidate instanceof HTMLElement)) continue;
		const selected = candidate.shadowRoot?.querySelector<HTMLElement>("[data-selected-line]");
		if (selected) return selected;
	}
	return null;
}

export const DiffViewer = memo(function DiffViewer({
	detail,
	loading,
	error,
	threads,
	focusedThreadId,
	selectedAnchor,
	onSelectAnchor,
	onFocusThread,
}: {
	detail: DiffFileDetail | null;
	loading: boolean;
	error?: string | null;
	threads: ReviewThread[];
	focusedThreadId?: string | null;
	selectedAnchor?: LineAnchor | null;
	onSelectAnchor?(anchor: LineAnchor | null): void;
	onFocusThread?(threadId: string): void;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const anchorScrollKey = getAnchorScrollKey(selectedAnchor);

	useEffect(() => {
		if (!anchorScrollKey) return;
		const frame = requestAnimationFrame(() => {
			findSelectedLineElement(containerRef.current)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
		});
		return () => cancelAnimationFrame(frame);
	}, [anchorScrollKey]);

	if (loading) return <EmptyState title="Loading file…" />;
	if (error) return <EmptyState title="Unable to load file" detail={error} />;
	if (!detail) return <EmptyState title="Select a file" />;
	return (
		<div ref={containerRef} style={getPaneScrollAreaStyle()}>
			<PierreDiffView
				detail={detail}
				threads={threads}
				focusedThreadId={focusedThreadId}
				selectedAnchor={selectedAnchor}
				onSelectAnchor={onSelectAnchor}
				onFocusThread={onFocusThread}
			/>
		</div>
	);
});
