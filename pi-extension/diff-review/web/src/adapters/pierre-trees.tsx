import { useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { TreeReloadDebugSignal } from "../debug.ts";
import { logDiffReviewTreeDebug } from "../debug.ts";
import type { DiffTreeEntry } from "../types.ts";
import { prepareTreeInput, syncPierreTreeSelection, toPierreGitStatus } from "./pierre-tree-model.ts";

let nextTreeInstanceId = 1;

function summarizePathChange(previousPaths: readonly string[], nextPaths: readonly string[]) {
	const firstDiffIndex = previousPaths.findIndex((path, index) => nextPaths[index] !== path);
	const sameLength = previousPaths.length === nextPaths.length;
	const sameContents = firstDiffIndex === -1 && sameLength;
	const diffIndex = sameContents ? null : (firstDiffIndex === -1 ? Math.min(previousPaths.length, nextPaths.length) : firstDiffIndex);
	return {
		previousCount: previousPaths.length,
		nextCount: nextPaths.length,
		sameLength,
		sameContents,
		firstDiffIndex: diffIndex,
		previousAtDiff: diffIndex == null ? null : (previousPaths[diffIndex] ?? null),
		nextAtDiff: diffIndex == null ? null : (nextPaths[diffIndex] ?? null),
	};
}

export function PierreRepoTree({
	paths,
	changedFiles,
	selectedPath,
	onSelect,
	treeReloadDebugSignal,
}: {
	paths: string[];
	changedFiles: DiffTreeEntry[];
	selectedPath: string | null;
	onSelect(path: string): void;
	treeReloadDebugSignal: TreeReloadDebugSignal | null;
}) {
	const preparedInput = useMemo(() => prepareTreeInput(paths), [paths]);
	const gitStatus = useMemo(() => toPierreGitStatus(changedFiles), [changedFiles]);
	const previousPathsRef = useRef<readonly string[]>(paths);
	const suppressSelectionChangeRef = useRef(false);
	const latestTreeReloadDebugSignalRef = useRef<TreeReloadDebugSignal | null>(treeReloadDebugSignal);
	const instanceIdRef = useRef<number | null>(null);
	if (instanceIdRef.current == null) {
		instanceIdRef.current = nextTreeInstanceId++;
	}
	const instanceId = instanceIdRef.current;
	latestTreeReloadDebugSignalRef.current = treeReloadDebugSignal;
	const { model } = useFileTree({
		preparedInput,
		search: false,
		initialExpansion: "open",
		initialSelectedPaths: selectedPath ? [selectedPath] : [],
		gitStatus,
		onSelectionChange(selectedPaths) {
			if (suppressSelectionChangeRef.current) return;
			const next = selectedPaths.find((path) => !path.endsWith("/"));
			logDiffReviewTreeDebug("selection-change", {
				instanceId,
				selectedPaths: [...selectedPaths],
				forwardedPath: next ?? null,
			});
			if (next) onSelect(next);
		},
	});

	useEffect(() => {
		logDiffReviewTreeDebug("mount", {
			instanceId,
			selectedPath,
			pathCount: paths.length,
			reason: treeReloadDebugSignal?.reason ?? "initial-mount",
			sequence: treeReloadDebugSignal?.sequence ?? null,
			detail: treeReloadDebugSignal?.detail ?? null,
		});
		return () => {
			logDiffReviewTreeDebug("unmount", {
				instanceId,
				reason: latestTreeReloadDebugSignalRef.current?.reason ?? null,
				sequence: latestTreeReloadDebugSignalRef.current?.sequence ?? null,
			});
		};
	}, [instanceId]);

	useEffect(() => model.onMutation("*", (event) => {
		logDiffReviewTreeDebug("mutation", {
			instanceId,
			event,
			latestReason: latestTreeReloadDebugSignalRef.current?.reason ?? null,
			latestSequence: latestTreeReloadDebugSignalRef.current?.sequence ?? null,
		});
	}), [instanceId, model]);

	useEffect(() => {
		if (previousPathsRef.current === paths) return;
		const previousPaths = previousPathsRef.current;
		previousPathsRef.current = paths;
		logDiffReviewTreeDebug("resetPaths", {
			instanceId,
			reason: treeReloadDebugSignal?.reason ?? "paths-prop-changed",
			sequence: treeReloadDebugSignal?.sequence ?? null,
			detail: treeReloadDebugSignal?.detail ?? null,
			pathChange: summarizePathChange(previousPaths, paths),
		});
		suppressSelectionChangeRef.current = true;
		try {
			model.resetPaths(paths, { preparedInput });
		} finally {
			suppressSelectionChangeRef.current = false;
		}
	}, [instanceId, model, paths, preparedInput, treeReloadDebugSignal]);

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
