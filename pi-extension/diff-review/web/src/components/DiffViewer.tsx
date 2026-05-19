import type { DiffFileDetail } from "../types.ts";
import { PierreDiffView } from "../adapters/pierre-diffs.tsx";
import { EmptyState } from "./EmptyState.tsx";

export function DiffViewer({ detail, loading, error }: { detail: DiffFileDetail | null; loading: boolean; error?: string | null }) {
	if (loading) return <EmptyState title="Loading file…" />;
	if (error) return <EmptyState title="Unable to load file" detail={error} />;
	if (!detail) return <EmptyState title="Select a file" />;
	return <div style={{ overflow: "auto", height: "100%" }}><PierreDiffView detail={detail} /></div>;
}
