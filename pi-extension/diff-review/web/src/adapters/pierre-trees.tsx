import { useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { DiffTreeEntry } from "../types.ts";
import { prepareTreeInput, syncPierreTreeSelection, toPierreGitStatus } from "./pierre-tree-model.ts";

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
	const previousPathsRef = useRef<readonly string[]>(paths);
	const suppressSelectionChangeRef = useRef(false);
	const { model } = useFileTree({
		preparedInput,
		search: false,
		initialExpansion: "open",
		initialSelectedPaths: selectedPath ? [selectedPath] : [],
		gitStatus,
		onSelectionChange(selectedPaths) {
			if (suppressSelectionChangeRef.current) return;
			const next = selectedPaths.find((path) => !path.endsWith("/"));
			if (next) onSelect(next);
		},
	});

	useEffect(() => {
		if (previousPathsRef.current === paths) return;
		previousPathsRef.current = paths;
		suppressSelectionChangeRef.current = true;
		try {
			model.resetPaths(paths, { preparedInput });
		} finally {
			suppressSelectionChangeRef.current = false;
		}
	}, [model, paths, preparedInput]);

	useEffect(() => {
		model.setGitStatus(gitStatus);
	}, [model, gitStatus]);

	useEffect(() => {
		suppressSelectionChangeRef.current = true;
		try {
			syncPierreTreeSelection(model, selectedPath);
		} finally {
			suppressSelectionChangeRef.current = false;
		}
	}, [model, paths, selectedPath]);

	return <FileTree model={model} style={{ height: "100%" }} />;
}
