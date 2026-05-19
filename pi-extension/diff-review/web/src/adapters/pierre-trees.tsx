import { useEffect, useMemo } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { DiffTreeEntry } from "../types.ts";
import { prepareTreeInput, syncPierreTreeModel, toPierreGitStatus } from "./pierre-tree-model.ts";

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
	const preparedInput = useMemo(() => prepareTreeInput(paths), [paths]);
	const gitStatus = useMemo(() => toPierreGitStatus(changedFiles), [changedFiles]);
	const { model } = useFileTree({
		preparedInput,
		search: false,
		initialExpansion: "open",
		initialSelectedPaths: selectedPath ? [selectedPath] : [],
		gitStatus,
		onSelectionChange(selectedPaths) {
			const next = selectedPaths[0];
			if (next) onSelect(next);
		},
	});

	useEffect(() => {
		syncPierreTreeModel(model, { paths, changedFiles, selectedPath, preparedInput });
	}, [model, paths, changedFiles, selectedPath, preparedInput]);

	return <FileTree model={model} style={{ height: "100%" }} />;
}
