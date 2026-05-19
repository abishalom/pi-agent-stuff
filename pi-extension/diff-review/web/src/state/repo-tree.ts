import type { DiffTreeEntry } from "../types.ts";

export function createRepoTreeModelKey(paths: string[], changedFiles: DiffTreeEntry[]) {
	return JSON.stringify([
		paths,
		changedFiles.map((file) => [file.path, file.status, file.previousPath ?? null]),
	]);
}
