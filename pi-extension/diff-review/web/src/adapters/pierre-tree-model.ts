import { prepareFileTreeInput } from "@pierre/trees";
import type { FileTreePreparedInput, GitStatusEntry } from "@pierre/trees";
import type { DiffTreeEntry } from "../types.ts";

export function toPierreGitStatus(changedFiles: DiffTreeEntry[]): GitStatusEntry[] {
	return changedFiles.map((file) => ({
		path: file.path,
		status: file.status === "binary" ? "modified" : file.status,
	}));
}

export function prepareTreeInput(paths: string[]): FileTreePreparedInput {
	return prepareFileTreeInput(paths);
}

export function syncPierreTreeModel(
	model: {
		resetPaths(paths: readonly string[], options?: { preparedInput?: FileTreePreparedInput }): void;
		setGitStatus(entries?: readonly GitStatusEntry[]): void;
		focusPath(path: string): void;
		getItem(path: string): { select(): void } | null;
	},
	args: {
		paths: string[];
		changedFiles: DiffTreeEntry[];
		selectedPath: string | null;
		preparedInput: FileTreePreparedInput;
	},
) {
	model.resetPaths(args.paths, { preparedInput: args.preparedInput });
	model.setGitStatus(toPierreGitStatus(args.changedFiles));
	if (!args.selectedPath) return;
	model.focusPath(args.selectedPath);
	model.getItem(args.selectedPath)?.select();
}
