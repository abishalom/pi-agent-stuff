import { memo } from "react";
import type { DiffTreeEntry } from "../types.ts";
import { PierreRepoTree } from "../adapters/pierre-trees.tsx";

export const RepoTreePanel = memo(function RepoTreePanel({
	paths,
	changedFiles,
	selectedPath,
	onSelect,
}: {
	paths: string[];
	changedFiles: DiffTreeEntry[];
	selectedPath: string | null;
	onSelect(path: string): void;
}) {
	return (
		<div style={{ height: "100%", overflow: "hidden" }}>
			<PierreRepoTree
				paths={paths}
				changedFiles={changedFiles}
				selectedPath={selectedPath}
				onSelect={onSelect}
			/>
		</div>
	);
});
