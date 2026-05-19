import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createReviewSessionState } from "../../pi-extension/diff-review/web/src/state/review-session.ts";
import { getSubmitButtonLabel, getComposerIdleActions, reuseShallowEqualArray } from "../../pi-extension/diff-review/web/src/ui.ts";
import { selectionRangeToAnchor } from "../../pi-extension/diff-review/web/src/adapters/pierre-diffs.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const staticDir = path.join(repoRoot, "pi-extension/diff-review/static");

function makeBootstrapPayload() {
	return {
		reviewSessionId: "review-session-1",
		repoRoot: "/repo",
		diffMode: "working-tree-vs-head",
		requestedMode: "merge-base-vs-head",
		effectiveMode: "working-tree-vs-head",
		warning: "merge-base unavailable, falling back to working-tree-vs-head",
		pendingSubmission: null,
		submissionHistory: [],
		files: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
		paths: ["README.md", "src/a.ts", "src/b.ts"],
		changedPaths: ["src/a.ts"],
		changedFiles: [{ path: "src/a.ts", status: "modified" }],
		threads: [
			{
				id: "thread-1",
				path: "src/a.ts",
				root: {
					id: "comment-1",
					path: "src/a.ts",
					body: "Please review this change",
					status: "open",
					line: { startLine: 4, endLine: 4, targetSide: "new" },
					createdAt: 1,
				},
				userReplies: [],
				replies: [],
			},
		],
	};
}

function makeLineAnchor(pathname, startLine) {
	return { path: pathname, startLine, endLine: startLine, targetSide: "new" };
}

function makeReplyEvent(threadId, text) {
	return {
		id: "reply-1",
		reviewSessionId: "review-session-1",
		submissionRoundId: "round-1",
		threadId,
		path: "src/a.ts",
		reply: text,
		recordedAt: Date.now(),
	};
}

function makeSessionClosedEvent(message) {
	return { reviewSessionId: "review-session-1", message };
}

async function runVerifyWithStaticDir(targetStaticDir) {
	await execFileAsync("npm", ["run", "verify:diff-review-web"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, DIFF_REVIEW_STATIC_DIR: targetStaticDir },
	});
}

async function runVerifyWithDirtyStaticFixture() {
	const fixtureRoot = await mkdtemp(path.join(tmpdir(), "diff-review-web-static-"));
	const fixtureStaticDir = path.join(fixtureRoot, "static");
	await cp(staticDir, fixtureStaticDir, { recursive: true });
	const indexPath = path.join(fixtureStaticDir, "index.html");
	const original = await readFile(indexPath, "utf8");
	await writeFile(indexPath, `${original}\n<!-- dirty fixture -->\n`, "utf8");
	try {
		await runVerifyWithStaticDir(fixtureStaticDir);
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
}

async function importWebModule(relativePath) {
	return import(new URL(relativePath, import.meta.url).href);
}

test("frontend review-session state supports file drafts, selected line drafts, inline reply drafts, and reply rendering", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	state.selectPath("src/a.ts");
	state.startFileDraft("src/a.ts");
	state.updateDraftText("General file-level feedback");
	assert.equal(state.draft?.kind, "thread");
	assert.equal(state.draft?.path, "src/a.ts");
	assert.equal(state.draft?.line, undefined);
	assert.equal(state.draft?.text, "General file-level feedback");

	state.startLineDraft(makeLineAnchor("src/a.ts", 4));
	state.updateDraftText("Please revisit this line");
	assert.equal(state.draft?.kind, "thread");
	assert.equal(state.draft?.line?.startLine, 4);
	assert.equal(state.draft?.line?.endLine, 4);

	state.startReplyDraft("thread-1");
	state.updateDraftText("Following up in the same thread");
	assert.equal(state.draft?.kind, "reply");
	assert.equal(state.draft?.threadId, "thread-1");
	assert.equal(state.draft?.path, "src/a.ts");
	assert.deepEqual(state.draft?.line, { startLine: 4, endLine: 4, targetSide: "new" });

	state.applyUserReply({
		threadId: "thread-1",
		reply: {
			id: "comment-2",
			path: "src/a.ts",
			body: "Following up in the same thread",
			status: "open",
			line: { startLine: 4, endLine: 4, targetSide: "new" },
			createdAt: 2,
		},
	});
	state.applyReply(makeReplyEvent("thread-1", "Looks good"));
	assert.equal(state.selectedPath, "src/a.ts");
	assert.match(state.mergeBaseWarning ?? "", /merge-base/i);
	assert.equal(state.threads[0].userReplies.at(-1)?.body, "Following up in the same thread");
	assert.equal(state.threads[0].replies.at(-1)?.reply, "Looks good");
});


test("frontend review-session state tracks collapsed thread UI state by thread id", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	assert.equal(state.isThreadCollapsed("thread-1"), false);
	state.toggleThreadCollapsed("thread-1");
	assert.equal(state.isThreadCollapsed("thread-1"), true);
	state.toggleThreadCollapsed("thread-1");
	assert.equal(state.isThreadCollapsed("thread-1"), false);
});

test("frontend review-session state preserves session-closed message across later reconnect errors", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	state.applySessionClosed(makeSessionClosedEvent("session ended"));
	state.applyConnectionError("Connection lost. Attempting to reconnect…");
	assert.equal(state.connectionState, "closed");
	assert.match(state.errorMessage ?? "", /session ended/i);
});

test("frontend review-session state prefers closed/error banner over merge-base warning", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	assert.match(state.getBannerMessage() ?? "", /merge-base/i);
	state.applySessionClosed(makeSessionClosedEvent("session ended"));
	assert.match(state.getBannerMessage() ?? "", /session ended/i);
});

test("frontend review-session state can refresh changed-tree data after diff-mode changes", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	state.setShowChangedOnly(true);
	assert.equal(typeof state.applyTree, "function");
	if (typeof state.applyTree !== "function") return;
	state.applyTree({
		paths: ["README.md", "src/a.ts", "src/b.ts"],
		changedPaths: ["src/b.ts"],
		changedFiles: [{ path: "src/b.ts", status: "modified" }],
	});
	assert.deepEqual(state.getVisiblePaths(), ["src/b.ts"]);
	assert.deepEqual(state.changedFiles, [{ path: "src/b.ts", status: "modified" }]);
	assert.equal(state.selectedPath, "src/b.ts");
});

test("frontend review-session state can focus a thread and sync the selected file", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	state.focusThread("thread-1");
	assert.equal(state.focusedThreadId, "thread-1");
	assert.equal(state.selectedPath, "src/a.ts");
});

test("reuseShallowEqualArray preserves selected thread identity across unrelated draft edits", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	state.selectPath("src/a.ts");
	const previous = state.getThreadsForSelectedPath();
	state.startFileDraft("src/a.ts");
	state.updateDraftText("Unrelated draft text");
	const next = state.getThreadsForSelectedPath();
	assert.notEqual(next, previous);
	assert.equal(reuseShallowEqualArray(previous, next), previous);
	const expanded = [...next, next[0]];
	assert.equal(reuseShallowEqualArray(previous, expanded), expanded);
});

test("syncPierreTreeModel mutates the Pierre tree model instead of relying on remount keys", async () => {
	const { syncPierreTreeModel } = await importWebModule("../../pi-extension/diff-review/web/src/adapters/pierre-tree-model.ts");
	const calls = [];
	const model = {
		resetPaths(paths, options) {
			calls.push(["resetPaths", [...paths], options]);
		},
		setGitStatus(entries) {
			calls.push(["setGitStatus", entries]);
		},
		focusPath(pathname) {
			calls.push(["focusPath", pathname]);
		},
		getItem(pathname) {
			calls.push(["getItem", pathname]);
			return { select() { calls.push(["select", pathname]); } };
		},
	};

	syncPierreTreeModel(model, {
		paths: ["README.md", "src/a.ts"],
		changedFiles: [{ path: "src/a.ts", status: "modified" }],
		selectedPath: "src/a.ts",
		preparedInput: { fake: true },
	});

	assert.deepEqual(calls.map(([name]) => name), [
		"resetPaths",
		"setGitStatus",
		"focusPath",
		"getItem",
		"select",
	]);
});

test("prepareTreeInput stays compatible with FileTree resetPaths for unsorted path lists", async () => {
	const { FileTree } = await import("@pierre/trees");
	const { prepareTreeInput, syncPierreTreeModel } = await importWebModule("../../pi-extension/diff-review/web/src/adapters/pierre-tree-model.ts");
	const paths = ["src/b.ts", "README.md", "src/a.ts"];
	const preparedInput = prepareTreeInput(paths);
	const model = new FileTree({ preparedInput, initialExpansion: "open" });
	assert.doesNotThrow(() => {
		syncPierreTreeModel(model, {
			paths,
			changedFiles: [{ path: "src/a.ts", status: "modified" }],
			selectedPath: "src/a.ts",
			preparedInput,
		});
	});
});

test("toPierreGitStatus maps binary entries to modified for Pierre git-status rendering", async () => {
	const { toPierreGitStatus } = await importWebModule("../../pi-extension/diff-review/web/src/adapters/pierre-tree-model.ts");
	assert.deepEqual(toPierreGitStatus([
		{ path: "bin.dat", status: "binary" },
		{ path: "src/a.ts", status: "modified" },
	]), [
		{ path: "bin.dat", status: "modified" },
		{ path: "src/a.ts", status: "modified" },
	]);
});

test("buildDiffLineAnnotations groups anchored threads by side and line", async () => {
	const { buildDiffLineAnnotations } = await importWebModule("../../pi-extension/diff-review/web/src/adapters/diff-review-annotations.ts");
	const annotations = buildDiffLineAnnotations([
		{
			id: "thread-1",
			path: "src/a.ts",
			root: {
				id: "comment-1",
				path: "src/a.ts",
				body: "one",
				status: "open",
				line: { startLine: 7, endLine: 7, targetSide: "new" },
			},
			userReplies: [],
			replies: [],
		},
		{
			id: "thread-2",
			path: "src/a.ts",
			root: {
				id: "comment-2",
				path: "src/a.ts",
				body: "two",
				status: "open",
				line: { startLine: 7, endLine: 8, targetSide: "new" },
			},
			userReplies: [],
			replies: [],
		},
	], "new");

	assert.deepEqual(annotations, [
		{ side: "additions", lineNumber: 7, metadata: { threadIds: ["thread-1", "thread-2"], count: 2 } },
		{ side: "additions", lineNumber: 8, metadata: { threadIds: ["thread-2"], count: 1 } },
	]);
});


test("getSelectedDraftAnchor returns null before session bootstrap completes", async () => {
	const { getSelectedDraftAnchor } = await importWebModule("../../pi-extension/diff-review/web/src/ui.ts");
	assert.equal(typeof getSelectedDraftAnchor, "function");
	assert.equal(getSelectedDraftAnchor(null, undefined), null);
});

test("diff toolbar uses the Submit feedback CTA label", () => {
	assert.equal(getSubmitButtonLabel(false), "Submit feedback");
	assert.equal(getSubmitButtonLabel(true), "Waiting for Pi…");
});


test("comment composer exposes a dedicated File comment action when no draft is active", () => {
	assert.deepEqual(getComposerIdleActions(), ["File comment"]);
});


test("Pierre diff selection ranges are converted into anchors without defaulting to line 1", () => {
	assert.deepEqual(
		selectionRangeToAnchor("src/a.ts", { start: 7, end: 9, side: "additions", endSide: "additions" }),
		{ path: "src/a.ts", startLine: 7, endLine: 9, targetSide: "new" },
	);
	assert.deepEqual(
		selectionRangeToAnchor("src/a.ts", { start: 3, end: 3, side: "deletions", endSide: "deletions" }),
		{ path: "src/a.ts", startLine: 3, endLine: 3, targetSide: "old" },
	);
	assert.equal(selectionRangeToAnchor("src/a.ts", null), null);
});

test("hoveredLineToAnchor maps additions and deletions to the correct target side", async () => {
	const { hoveredLineToAnchor } = await importWebModule("../../pi-extension/diff-review/web/src/adapters/pierre-diffs.ts");
	assert.deepEqual(
		hoveredLineToAnchor("src/a.ts", { lineNumber: 12, side: "additions" }),
		{ path: "src/a.ts", startLine: 12, endLine: 12, targetSide: "new" },
	);
	assert.deepEqual(
		hoveredLineToAnchor("src/a.ts", { lineNumber: 5, side: "deletions" }),
		{ path: "src/a.ts", startLine: 5, endLine: 5, targetSide: "old" },
	);
	assert.equal(hoveredLineToAnchor("src/a.ts", undefined), null);
});

test("verify:diff-review-web fails when committed static assets drift", async () => {
	await assert.rejects(() => runVerifyWithDirtyStaticFixture(), /static assets are stale/i);
});
