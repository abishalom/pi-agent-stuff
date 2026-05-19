import { useEffect } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { DiffTreeEntry } from "../types.ts";

export function PierreRepoTree({
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
	const { model } = useFileTree({
		paths,
		search: false,
		initialExpansion: "open",
		initialSelectedPaths: selectedPath ? [selectedPath] : [],
		gitStatus: changedFiles.map((file) => ({
			path: file.path,
			status: file.status === "binary" ? "modified" : file.status,
		})),
		onSelectionChange(selectedPaths) {
			const next = selectedPaths[0];
			if (next) onSelect(next);
		},
	});

	useEffect(() => {
		if (!selectedPath) return;
		model.focusPath(selectedPath);
		model.getItem(selectedPath)?.select();
	}, [model, selectedPath]);

	return <FileTree model={model} style={{ height: "100%" }} />;
}
