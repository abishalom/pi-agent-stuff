import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createReviewSessionState } from "../../pi-extension/diff-review/web/src/state/review-session.ts";
import {
	getActiveDiffAnchor,
	getAnchorScrollKey,
	getButtonStyle,
	getComposerIdleActions,
	getComposerKeyAction,
	getComposerShortcutHint,
	getDraftComposerPlacement,
	getNextThreadSortMode,
	getPaneScrollAreaStyle,
	getPaneStackStyle,
	getReviewColumnStyle,
	getSelectStyle,
	getSubmitButtonLabel,
	getTextFieldStyle,
	getThreadCardLayout,
	getThreadListStyle,
	getThreadSortButtonLabel,
	sortThreads,
	reuseShallowEqualArray,
} from "../../pi-extension/diff-review/web/src/ui.ts";
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

test("frontend review-session state defaults to showing changed files in the tree", () => {
	const state = createReviewSessionState(makeBootstrapPayload());
	assert.equal(state.showChangedOnly, true);
	assert.deepEqual(state.getVisiblePaths(), ["src/a.ts"]);
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

test("getActiveDiffAnchor falls back to the focused thread anchor and prefers active draft selections", () => {
	const payload = makeBootstrapPayload();
	assert.deepEqual(getActiveDiffAnchor({
		draft: null,
		selectedPath: "src/a.ts",
		threads: payload.threads,
		focusedThreadId: "thread-1",
	}), { path: "src/a.ts", startLine: 4, endLine: 4, targetSide: "new" });
	assert.deepEqual(getActiveDiffAnchor({
		draft: { id: "draft-1", kind: "thread", path: "src/a.ts", line: { path: "src/a.ts", startLine: 8, endLine: 9, targetSide: "new" }, text: "draft" },
		selectedPath: "src/a.ts",
		threads: payload.threads,
		focusedThreadId: "thread-1",
	}), { path: "src/a.ts", startLine: 8, endLine: 9, targetSide: "new" });
});

test("getThreadCardLayout keeps expanded cards content-sized while collapsed cards stay compact", () => {
	const collapsed = getThreadCardLayout(true, false);
	const expanded = getThreadCardLayout(false, false);
	assert.ok(collapsed.padding < expanded.padding);
	assert.ok(collapsed.gap < expanded.gap);
	assert.equal(collapsed.showCollapsedSummary, true);
	assert.equal(expanded.showCollapsedSummary, false);
	assert.equal(collapsed.height, 88);
	assert.equal(expanded.height, "auto");
	assert.ok(collapsed.toggleButtonSize > 24);
});

test("thread list layout packs cards at the top instead of stretching them through the sidebar", () => {
	const style = getThreadListStyle();
	assert.equal(style.display, "flex");
	assert.equal(style.flexDirection, "column");
	assert.equal(style.overflow, "auto");
	assert.equal(style.padding, 12);
	assert.equal(style.gap, 12);
});

test("review layout styles preserve independent scrolling for tree, diff, and threads", () => {
	const column = getReviewColumnStyle();
	const stack = getPaneStackStyle();
	const scroller = getPaneScrollAreaStyle();
	assert.equal(column.minHeight, 0);
	assert.equal(column.overflow, "hidden");
	assert.equal(stack.minHeight, 0);
	assert.equal(stack.overflow, "hidden");
	assert.equal(scroller.minHeight, 0);
	assert.equal(scroller.overflow, "auto");
	assert.equal(scroller.height, "100%");
});

test("thread sorting cycles through creation time, last activity, and line number", () => {
	const threads = [
		{
			id: "thread-1",
			path: "src/a.ts",
			root: { id: "comment-1", path: "src/a.ts", body: "one", status: "open", line: { startLine: 20, endLine: 20, targetSide: "new" }, createdAt: 10 },
			userReplies: [{ id: "comment-1a", path: "src/a.ts", body: "follow up", status: "open", line: { startLine: 20, endLine: 20, targetSide: "new" }, createdAt: 40 }],
			replies: [],
		},
		{
			id: "thread-2",
			path: "src/a.ts",
			root: { id: "comment-2", path: "src/a.ts", body: "two", status: "open", line: { startLine: 5, endLine: 5, targetSide: "new" }, createdAt: 20 },
			userReplies: [],
			replies: [{ id: "reply-2", reviewSessionId: "review-session-1", submissionRoundId: "round-1", threadId: "thread-2", path: "src/a.ts", reply: "pi", recordedAt: 25 }],
		},
		{
			id: "thread-3",
			path: "src/a.ts",
			root: { id: "comment-3", path: "src/a.ts", body: "three", status: "open", createdAt: 30 },
			userReplies: [],
			replies: [],
		},
	];
	assert.deepEqual(sortThreads(threads, "creation-desc").map((thread) => thread.id), ["thread-3", "thread-2", "thread-1"]);
	assert.deepEqual(sortThreads(threads, "last-activity-desc").map((thread) => thread.id), ["thread-1", "thread-3", "thread-2"]);
	assert.deepEqual(sortThreads(threads, "line-number-asc").map((thread) => thread.id), ["thread-2", "thread-1", "thread-3"]);
	assert.equal(getThreadSortButtonLabel("creation-desc"), "Sort: newest");
	assert.equal(getThreadSortButtonLabel("last-activity-desc"), "Sort: active");
	assert.equal(getThreadSortButtonLabel("line-number-asc"), "Sort: line");
	assert.equal(getNextThreadSortMode("creation-desc"), "last-activity-desc");
	assert.equal(getNextThreadSortMode("last-activity-desc"), "line-number-asc");
	assert.equal(getNextThreadSortMode("line-number-asc"), "creation-desc");
});

test("line and range comment drafts use a floating popup while file comments stay in the sidebar", () => {
	assert.equal(getDraftComposerPlacement(null), "sidebar");
	assert.equal(getDraftComposerPlacement({ id: "draft-1", kind: "thread", path: "src/a.ts", text: "file" }), "sidebar");
	assert.equal(getDraftComposerPlacement({ id: "draft-2", kind: "thread", path: "src/a.ts", line: { path: "src/a.ts", startLine: 7, endLine: 8, targetSide: "new" }, text: "line" }), "floating");
	assert.equal(getDraftComposerPlacement({ id: "draft-3", kind: "reply", threadId: "thread-1", path: "src/a.ts", line: { path: "src/a.ts", startLine: 7, endLine: 7, targetSide: "new" }, text: "reply" }), "thread");
});

test("composer keyboard actions map Enter to submit, Escape to cancel, and Shift+Enter to newline", () => {
	assert.equal(getComposerKeyAction({ key: "Enter", shiftKey: false }), "submit");
	assert.equal(getComposerKeyAction({ key: "Escape", shiftKey: false }), "cancel");
	assert.equal(getComposerKeyAction({ key: "Enter", shiftKey: true }), null);
	assert.equal(getComposerKeyAction({ key: "a", shiftKey: false }), null);
	assert.match(getComposerShortcutHint(), /enter.*submit/i);
	assert.match(getComposerShortcutHint(), /shift\+enter.*new line/i);
	assert.match(getComposerShortcutHint(), /esc.*cancel/i);
});

test("anchor scroll keys stay stable for focused thread jumps", () => {
	assert.equal(getAnchorScrollKey(null), null);
	assert.equal(
		getAnchorScrollKey({ path: "src/a.ts", startLine: 12, endLine: 14, targetSide: "old" }),
		"src/a.ts:old:12-14",
	);
});

test("shared control styles keep buttons, selects, and text fields on-theme", () => {
	const primaryButton = getButtonStyle("primary");
	const secondaryButton = getButtonStyle("secondary");
	const disabledButton = getButtonStyle("primary", { disabled: true });
	const select = getSelectStyle();
	const textarea = getTextFieldStyle({ minHeight: 88 });
	assert.equal(primaryButton.background, "#2563eb");
	assert.equal(secondaryButton.background, "#0f172a");
	assert.equal(disabledButton.cursor, "not-allowed");
	assert.equal(select.background, "#0f172a");
	assert.equal(textarea.minHeight, 88);
	assert.equal(textarea.color, "#e2e8f0");
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
