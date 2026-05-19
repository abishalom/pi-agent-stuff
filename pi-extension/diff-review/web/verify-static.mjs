import path from "node:path";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { build, mergeConfig } from "vite";
import config from "./vite.config.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const targetStaticDir = path.resolve(repoRoot, process.env.DIFF_REVIEW_STATIC_DIR ?? "pi-extension/diff-review/static");
const tempDir = await mkdtemp(path.join(tmpdir(), "diff-review-web-build-"));

try {
	await build(mergeConfig(config, {
		build: {
			outDir: tempDir,
			emptyOutDir: true,
		},
	}));
	const [expected, actual] = await Promise.all([snapshotDir(tempDir), snapshotDir(targetStaticDir)]);
	if (expected !== actual) {
		throw new Error("static assets are stale");
	}
} finally {
	await rm(tempDir, { recursive: true, force: true });
}

async function snapshotDir(root) {
	const names = [];
	for (const entry of (await readdir(root, { recursive: true, withFileTypes: true })).sort((a, b) => a.parentPath.localeCompare(b.parentPath) || a.name.localeCompare(b.name))) {
		if (!entry.isFile()) continue;
		const relativePath = path.relative(root, path.join(entry.parentPath, entry.name));
		names.push(`FILE:${relativePath}`);
		names.push(await readFile(path.join(root, relativePath), "utf8"));
	}
	return names.join("\n--\n");
}
