import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename as renameFile, rm, unlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createDiffProvider } from "../../pi-extension/diff-review/git.ts";

const execFileAsync = promisify(execFile);

async function run(command, args, cwd) {
	return execFileAsync(command, args, { cwd, encoding: "utf8" });
}

async function createTempRepoFixture(options = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "diff-review-git-"));
	await run("git", ["init", "-q"], root);
	await run("git", ["config", "user.email", "test@example.com"], root);
	await run("git", ["config", "user.name", "Diff Review Test"], root);

	const repo = {
		root,
		async write(filePath, content) {
			const absolutePath = path.join(root, filePath);
			await mkdir(path.dirname(absolutePath), { recursive: true });
			if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
				await writeFile(absolutePath, content);
				return;
			}
			await writeFile(absolutePath, content, "utf8");
		},
		async read(filePath) {
			return readFile(path.join(root, filePath), "utf8");
		},
		async remove(filePath) {
			await unlink(path.join(root, filePath));
		},
		async rename(fromPath, toPath) {
			const nextPath = path.join(root, toPath);
			await mkdir(path.dirname(nextPath), { recursive: true });
			await renameFile(path.join(root, fromPath), nextPath);
		},
		async chmod(filePath, mode) {
			await chmod(path.join(root, filePath), mode);
		},
		async git(...args) {
			return run("git", args, root);
		},
		async commit(message) {
			await repo.git("add", "-A");
			await repo.git("commit", "-qm", message);
		},
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};

	if (!options.noHeadCommit) {
		await repo.write("src/a.ts", "export const a = 1;\n");
		await repo.commit("initial");
	}

	if (options.unreadableFile) {
		await repo.write(options.unreadableFile, "top secret\n");
		if (!options.noHeadCommit) {
			await repo.commit("add unreadable file");
		}
		await repo.chmod(options.unreadableFile, 0o000);
	}

	if (options.detached && !options.noHeadCommit) {
		await repo.git("checkout", "--detach");
	}

	return repo;
}

test("working-tree mode reports whole repo tree and changed-file set", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());

	await repo.write("src/a.ts", "export const a = 2;\n");

	const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
	const tree = await provider.loadTree();

	assert.ok(tree.paths.includes("src/a.ts"));
	assert.ok(tree.changedPaths.includes("src/a.ts"));
	assert.equal(tree.changedFiles.find((file) => file.path === "src/a.ts")?.status, "modified");
});

test("merge-base mode returns a clean fallback result when merge-base is unavailable", async (t) => {
	const repo = await createTempRepoFixture({ detached: true });
	t.after(() => repo.cleanup());

	const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "merge-base-vs-head" });
	const state = await provider.loadModeState();

	assert.equal(state.effectiveMode, "working-tree-vs-head");
	assert.match(state.warning ?? "", /merge-base/i);
});

test("provider fails clearly outside a git repo", async (t) => {
	const notRepo = await mkdtemp(path.join(tmpdir(), "diff-review-not-repo-"));
	t.after(() => rm(notRepo, { recursive: true, force: true }));

	await assert.rejects(() => createDiffProvider({ repoRoot: notRepo, diffMode: "working-tree-vs-head" }), /git repo/i);
});

test("working-tree mode surfaces missing HEAD clearly", async (t) => {
	const repo = await createTempRepoFixture({ noHeadCommit: true });
	t.after(() => repo.cleanup());

	const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
	await assert.rejects(() => provider.loadTree(), /HEAD/i);
});

test("unreadable files are flagged instead of crashing file load", async (t) => {
	const repo = await createTempRepoFixture({ unreadableFile: "secret.txt" });
	t.after(async () => {
		await repo.chmod("secret.txt", 0o644);
		await repo.cleanup();
	});

	const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
	const file = await provider.loadFile("secret.txt");

	assert.equal(file.loadError?.code, "unreadable");
});

test("loadFile reports modified, added, deleted, renamed, and binary diff metadata", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());

	await repo.write("delete-me.txt", "remove me\n");
	await repo.write("rename-me.txt", "rename me\n");
	await repo.write("bin.dat", Buffer.from([0, 1, 2, 3]));
	await repo.commit("add fixtures");

	await repo.write("src/a.ts", "export const a = 2;\n");
	await repo.write("added.txt", "brand new\n");
	await repo.remove("delete-me.txt");
	await repo.git("mv", "rename-me.txt", "renamed.txt");
	await repo.write("bin.dat", Buffer.from([0, 9, 8, 7]));

	const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });

	const modifiedFile = await provider.loadFile("src/a.ts");
	assert.equal(modifiedFile.status, "modified");
	assert.match(modifiedFile.oldContent ?? "", /a = 1/);
	assert.match(modifiedFile.newContent ?? "", /a = 2/);

	const addedFile = await provider.loadFile("added.txt");
	assert.equal(addedFile.status, "added");
	assert.equal(addedFile.oldContent, null);
	assert.match(addedFile.newContent ?? "", /brand new/);

	const deletedFile = await provider.loadFile("delete-me.txt");
	assert.equal(deletedFile.status, "deleted");
	assert.equal(deletedFile.currentContent, null);
	assert.match(deletedFile.oldContent ?? "", /remove me/);

	const renamedFile = await provider.loadFile("renamed.txt");
	assert.equal(renamedFile.status, "renamed");
	assert.equal(renamedFile.previousPath, "rename-me.txt");
	assert.match(renamedFile.newContent ?? "", /rename me/);

	const binaryFile = await provider.loadFile("bin.dat");
	assert.equal(binaryFile.status, "binary");
	assert.equal(binaryFile.isBinary, true);
	assert.equal(binaryFile.oldBinary, true);
	assert.equal(binaryFile.newBinary, true);
});
