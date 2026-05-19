import type { DiffFileDetail, LineAnchor } from "../types.ts";
import { PierreDiffView } from "../adapters/pierre-diffs.tsx";
import { EmptyState } from "./EmptyState.tsx";

export function DiffViewer({
	detail,
	loading,
	error,
	selectedAnchor,
	onSelectAnchor,
}: {
	detail: DiffFileDetail | null;
	loading: boolean;
	error?: string | null;
	selectedAnchor?: LineAnchor | null;
	onSelectAnchor?(anchor: LineAnchor | null): void;
}) {
	if (loading) return <EmptyState title="Loading file…" />;
	if (error) return <EmptyState title="Unable to load file" detail={error} />;
	if (!detail) return <EmptyState title="Select a file" />;
	return <div style={{ overflow: "auto", height: "100%" }}><PierreDiffView detail={detail} selectedAnchor={selectedAnchor} onSelectAnchor={onSelectAnchor} /></div>;
}
