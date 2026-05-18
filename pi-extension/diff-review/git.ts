import { execFile } from "node:child_process";
import { readFile as defaultReadFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
	DiffFileDetail,
	DiffFileLoadError,
	DiffFileStatus,
	DiffMode,
	DiffProvider,
	DiffProviderModeState,
	DiffTree,
	DiffTreeEntry,
} from "./types.ts";

const execFileAsync = promisify(execFile);

async function runGit(repoRoot: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8") {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd: repoRoot,
			encoding,
			maxBuffer: 10 * 1024 * 1024,
		});
		return { stdout, stderr };
	} catch (error) {
		const reason = error?.stderr?.toString?.().trim() || error?.message || "unknown git error";
		throw new Error(`git ${args.join(" ")} failed: ${reason}`);
	}
}

function normalizeRepoError(repoRoot: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (/not a git repository|cannot change to/i.test(message)) {
		return new Error(`Not a git repo: ${repoRoot}`);
	}
	return error instanceof Error ? error : new Error(message);
}

function splitZeroTerminated(value: string | Buffer) {
	const chunks = value.toString("utf8").split("\0");
	if (chunks[chunks.length - 1] === "") {
		chunks.pop();
	}
	return chunks;
}

function parseNameStatus(output: string) {
	const fields = splitZeroTerminated(output);
	const entries: DiffTreeEntry[] = [];
	for (let index = 0; index < fields.length;) {
		const statusToken = fields[index++] ?? "";
		const kind = statusToken[0] ?? "";
		if (kind === "R") {
			const previousPath = fields[index++] ?? "";
			const filePath = fields[index++] ?? "";
			entries.push({ path: filePath, previousPath, status: "renamed" });
			continue;
		}
		const filePath = fields[index++] ?? "";
		entries.push({
			path: filePath,
			status: kind === "A" ? "added" : kind === "D" ? "deleted" : "modified",
		});
	}
	return entries;
}

function parseNumstat(output: string) {
	const fields = splitZeroTerminated(output);
	const binaryPaths = new Set<string>();
	for (let index = 0; index < fields.length;) {
		const stat = fields[index++] ?? "";
		const firstTab = stat.indexOf("\t");
		const secondTab = firstTab < 0 ? -1 : stat.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) {
			continue;
		}
		const added = stat.slice(0, firstTab);
		const deleted = stat.slice(firstTab + 1, secondTab);
		const filePath = stat.slice(secondTab + 1);
		if (filePath !== "") {
			if (added === "-" || deleted === "-") {
				binaryPaths.add(filePath);
			}
			continue;
		}
		const previousPath = fields[index++] ?? "";
		const nextPath = fields[index++] ?? "";
		if ((added === "-" || deleted === "-") && previousPath && nextPath) {
			binaryPaths.add(nextPath);
		}
	}
	return binaryPaths;
}

function detectBinary(buffer: Buffer | null) {
	return buffer != null && buffer.includes(0);
}

function toText(buffer: Buffer | null) {
	if (buffer == null || detectBinary(buffer)) {
		return null;
	}
	return buffer.toString("utf8");
}

function missingPathError(message: string) {
	return /exists on disk, but not in|does not exist in|pathspec/i.test(message);
}

async function readGitBlob(repoRoot: string, ref: string, filePath: string) {
	try {
		const { stdout } = await runGit(repoRoot, ["show", `${ref}:${filePath}`], "buffer");
		return stdout as Buffer;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (missingPathError(message)) {
			return null;
		}
		throw error;
	}
}

async function readWorkingTreeFile(
	repoRoot: string,
	filePath: string,
	readFileImpl: typeof defaultReadFile,
): Promise<{ buffer: Buffer | null; missing: boolean; loadError?: DiffFileLoadError }> {
	try {
		const buffer = await readFileImpl(path.join(repoRoot, filePath));
		if (!Buffer.isBuffer(buffer)) {
			return { buffer: Buffer.from(buffer), missing: false };
		}
		return { buffer, missing: false };
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) {
			if (error.code === "ENOENT") {
				return { buffer: null, missing: true };
			}
			if (error.code === "EACCES" || error.code === "EPERM" || error.code === "EISDIR") {
				return {
					buffer: null,
					missing: false,
					loadError: {
						code: "unreadable",
						message: `Unable to read working tree file: ${filePath}`,
					},
				};
			}
		}
		throw error;
	}
}

async function ensureHead(repoRoot: string) {
	try {
		const { stdout } = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
		return stdout.trim();
	} catch (error) {
		throw new Error(`Git repo at ${repoRoot} is missing HEAD`);
	}
}

async function resolveMergeBase(repoRoot: string) {
	const { stdout: upstream } = await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
	const upstreamRef = upstream.trim();
	const { stdout } = await runGit(repoRoot, ["merge-base", "HEAD", upstreamRef]);
	return stdout.trim();
}

async function listRepoPaths(repoRoot: string, effectiveMode: DiffMode, headRef?: string) {
	if (effectiveMode === "working-tree-vs-head") {
		const { stdout } = await runGit(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
		return splitZeroTerminated(stdout);
	}
	const { stdout } = await runGit(repoRoot, ["ls-tree", "-r", "--name-only", "-z", headRef!]);
	return splitZeroTerminated(stdout);
}

async function listUntrackedPaths(repoRoot: string) {
	const { stdout } = await runGit(repoRoot, ["ls-files", "-z", "--others", "--exclude-standard"]);
	return splitZeroTerminated(stdout);
}

async function loadChangedEntries(
	repoRoot: string,
	spec: { effectiveMode: DiffMode; baseRef?: string },
	readFileImpl: typeof defaultReadFile,
) {
	const diffArgs = spec.effectiveMode === "working-tree-vs-head"
		? ["diff", "--name-status", "-z", "HEAD"]
		: ["diff", "--name-status", "-z", spec.baseRef!, "HEAD"];
	const numstatArgs = spec.effectiveMode === "working-tree-vs-head"
		? ["diff", "--numstat", "-z", "HEAD"]
		: ["diff", "--numstat", "-z", spec.baseRef!, "HEAD"];
	const statusOutput = await runGit(repoRoot, diffArgs);
	const numstatOutput = await runGit(repoRoot, numstatArgs);
	const binaryPaths = parseNumstat(numstatOutput.stdout as string);
	const entries = parseNameStatus(statusOutput.stdout as string);
	const byPath = new Map(entries.map((entry) => [entry.path, { ...entry }]));
	for (const binaryPath of binaryPaths) {
		const current = byPath.get(binaryPath);
		if (current) {
			current.status = "binary";
		}
	}
	if (spec.effectiveMode === "working-tree-vs-head") {
		for (const filePath of await listUntrackedPaths(repoRoot)) {
			if (!byPath.has(filePath)) {
				const workingTree = await readWorkingTreeFile(repoRoot, filePath, readFileImpl);
				byPath.set(filePath, { path: filePath, status: detectBinary(workingTree.buffer) ? "binary" : "added" });
			}
		}
	}
	return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveMode(repoRoot: string, requestedMode: DiffMode): Promise<DiffProviderModeState & { baseRef?: string; headRef?: string }> {
	if (requestedMode === "working-tree-vs-head") {
		return {
			requestedMode,
			effectiveMode: "working-tree-vs-head",
			headRef: await ensureHead(repoRoot),
		};
	}

	const headRef = await ensureHead(repoRoot);
	try {
		return {
			requestedMode,
			effectiveMode: "merge-base-vs-head",
			baseRef: await resolveMergeBase(repoRoot),
			headRef,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			requestedMode,
			effectiveMode: "working-tree-vs-head",
			headRef,
			warning: `merge-base unavailable, falling back to working-tree-vs-head: ${message}`,
		};
	}
}

export async function createDiffProvider({
	repoRoot,
	diffMode,
	readFileImpl = defaultReadFile,
}: {
	repoRoot: string;
	diffMode: DiffMode;
	readFileImpl?: typeof defaultReadFile;
}): Promise<DiffProvider> {
	try {
		await runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
	} catch (error) {
		throw normalizeRepoError(repoRoot, error);
	}

	let cachedMode: Promise<DiffProviderModeState & { baseRef?: string; headRef?: string }> | null = null;
	let cachedChangedFiles: Promise<DiffTreeEntry[]> | null = null;
	let cachedTree: Promise<DiffTree> | null = null;

	function getMode() {
		cachedMode ??= resolveMode(repoRoot, diffMode);
		return cachedMode;
	}

	function getChangedFiles() {
		cachedChangedFiles ??= getMode().then((mode) => loadChangedEntries(repoRoot, mode, readFileImpl));
		return cachedChangedFiles;
	}

	return {
		async loadModeState() {
			const { requestedMode, effectiveMode, warning } = await getMode();
			return { requestedMode, effectiveMode, warning };
		},
		async loadTree(): Promise<DiffTree> {
			cachedTree ??= (async () => {
				const mode = await getMode();
				const paths = new Set(await listRepoPaths(repoRoot, mode.effectiveMode, mode.headRef));
				const changedFiles = await getChangedFiles();
				for (const file of changedFiles) {
					paths.add(file.path);
				}
				return {
					paths: [...paths].sort((a, b) => a.localeCompare(b)),
					changedPaths: changedFiles.map((file) => file.path),
					changedFiles,
				};
			})();
			return cachedTree;
		},
		async loadFile(filePath: string): Promise<DiffFileDetail> {
			const mode = await getMode();
			let workingTree = { buffer: null, missing: true } as Awaited<ReturnType<typeof readWorkingTreeFile>>;
			if (mode.effectiveMode === "working-tree-vs-head") {
				workingTree = await readWorkingTreeFile(repoRoot, filePath, readFileImpl);
			}
			let changedFiles: DiffTreeEntry[] = [];
			try {
				changedFiles = await getChangedFiles();
			} catch (error) {
				if (workingTree.loadError?.code !== "unreadable") {
					throw error;
				}
			}
			const changed = changedFiles.find((entry) => entry.path === filePath) ?? null;
			const previousPath = changed?.previousPath;
			const oldPath = previousPath ?? filePath;
			const oldBuffer = mode.effectiveMode === "working-tree-vs-head"
				? (changed?.status === "added" ? null : await readGitBlob(repoRoot, mode.headRef!, oldPath))
				: await readGitBlob(repoRoot, mode.baseRef!, oldPath);
			const newBuffer = mode.effectiveMode === "working-tree-vs-head"
				? (changed?.status === "deleted" ? null : workingTree.buffer)
				: await readGitBlob(repoRoot, mode.headRef!, filePath);
			const oldBinary = detectBinary(oldBuffer);
			const newBinary = detectBinary(newBuffer);
			const currentBinary = detectBinary(workingTree.buffer);
			const isBinary = changed?.status === "binary" || oldBinary || newBinary || currentBinary;
			const status: DiffFileStatus | "unchanged" = isBinary && changed ? "binary" : changed?.status ?? "unchanged";
			const loadError = workingTree.loadError ?? (
				workingTree.missing && oldBuffer == null && newBuffer == null
					? {
						code: "missing",
						message: `Requested path is missing from disk and compared refs: ${filePath}`,
					  }
					: undefined
			);
			return {
				path: filePath,
				previousPath,
				status,
				currentContent: currentBinary ? null : toText(workingTree.buffer),
				oldContent: oldBinary ? null : toText(oldBuffer),
				newContent: newBinary ? null : toText(newBuffer),
				isBinary,
				oldBinary,
				newBinary,
				currentBinary,
				loadError,
			};
		},
	};
}
