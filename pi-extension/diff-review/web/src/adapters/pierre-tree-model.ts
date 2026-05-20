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

export function syncPierreTreeSelection(
	model: {
		getSelectedPaths(): readonly string[];
		getItem(path: string): { deselect(): void; isSelected(): boolean; select(): void } | null;
	},
	selectedPath: string | null,
) {
	const currentSelectedPaths = [...model.getSelectedPaths()];
	if (!selectedPath) {
		for (const path of currentSelectedPaths) {
			model.getItem(path)?.deselect();
		}
		return;
	}
	if (currentSelectedPaths.length === 1 && currentSelectedPaths[0] === selectedPath) {
		return;
	}
	for (const path of currentSelectedPaths) {
		if (path === selectedPath) continue;
		model.getItem(path)?.deselect();
	}
	const selectedItem = model.getItem(selectedPath);
	if (!selectedItem || selectedItem.isSelected()) return;
	selectedItem.select();
}
