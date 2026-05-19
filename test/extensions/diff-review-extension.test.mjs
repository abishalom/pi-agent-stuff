import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createReviewSessionStore } from "../../pi-extension/diff-review/state.ts";
import { recordReply } from "../../pi-extension/diff-review/reply-tool.ts";
import { createDiffReviewExtension } from "../../pi-extension/diff-review/index.ts";
import { shutdownSessionsForPiSessionKey } from "../../pi-extension/diff-review/cleanup.ts";

const execFileAsync = promisify(execFile);

async function run(command, args, cwd) {
	return execFileAsync(command, args, { cwd, encoding: "utf8" });
}

async function createTempRepoFixture() {
	const root = await mkdtemp(path.join(tmpdir(), "diff-review-extension-"));
	await run("git", ["init", "-q"], root);
	await run("git", ["config", "user.email", "test@example.com"], root);
	await run("git", ["config", "user.name", "Diff Review Test"], root);
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
	await run("git", ["add", "-A"], root);
	await run("git", ["commit", "-qm", "initial"], root);
	return {
		root,
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};
}

function createFakePi() {
	const commands = new Map();
	const tools = new Map();
	const events = new Map();

	return {
		commands,
		tools,
		events,
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerTool(definition) {
			tools.set(definition.name, definition);
		},
		on(name, handler) {
			events.set(name, handler);
		},
	};
}

function makeCommandContext(overrides = {}) {
	const notifications = [];
	return {
		piSessionKey: overrides.piSessionKey ?? "s1",
		cwd: overrides.cwd ?? "/repo",
		hasUI: true,
		isIdle: overrides.isIdle ?? (() => true),
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
		},
		notifications,
	};
}

function makeSessionSeed() {
	return {
		piSessionKey: "s1",
		repoRoot: "/repo-a",
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
		pendingSubmission: {
			id: "round-1",
			reviewSessionId: "review-session-1",
			threadIds: ["thread-1"],
		},
		files: [
			{ path: "src/a.ts" },
			{ path: "src/b.ts" },
		],
		threads: [
			{
				id: "thread-1",
				path: "src/a.ts",
				root: {
					id: "comment-1",
					path: "src/a.ts",
					body: "Please review this change",
					status: "submitted",
					line: { startLine: 4, endLine: 6, targetSide: "new" },
				},
				replies: [],
			},
			{
				id: "thread-2",
				path: "src/b.ts",
				root: {
					id: "comment-2",
					path: "src/b.ts",
					body: "This thread is outside the active round",
					status: "submitted",
					line: { startLine: 8, endLine: 8, targetSide: "new" },
				},
				replies: [],
			},
		],
	};
}

test("diff-review extension registers command and reply tool", () => {
	const pi = createFakePi();
	createDiffReviewExtension()(pi);

	assert.ok(pi.commands.has("diff-review"));
	assert.ok(pi.tools.has("diff_review_reply"));
	assert.ok(pi.events.has("session_shutdown"));
});

test("/diff-review reuses an existing session for the same repo", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const pi = createFakePi();
	let createdServerCount = 0;
	createDiffReviewExtension({
		startServer: async () => {
			createdServerCount += 1;
			return { baseUrl: "http://127.0.0.1:4321", close: async () => {} };
		},
	})(pi);
	const ctx = makeCommandContext({ piSessionKey: "s1", cwd: repo.root });

	await pi.commands.get("diff-review").handler("", ctx);
	await pi.commands.get("diff-review").handler("", ctx);

	assert.equal(createdServerCount, 1);
	assert.equal(ctx.notifications.length, 2);
	assert.match(ctx.notifications[0].message, /127\.0\.0\.1/);
});

test("/diff-review concurrent reuse creates only one server when handlers overlap", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const pi = createFakePi();
	let createdServerCount = 0;
	let releaseStartup;
	let firstStartupEntered;
	const startupGate = new Promise((resolve) => {
		releaseStartup = resolve;
	});
	const startupEntered = new Promise((resolve) => {
		firstStartupEntered = resolve;
	});
	createDiffReviewExtension({
		startServer: async () => {
			createdServerCount += 1;
			firstStartupEntered();
			await startupGate;
			return { baseUrl: "http://127.0.0.1:4321", close: async () => {} };
		},
	})(pi);
	const ctx = makeCommandContext({ piSessionKey: "s1", cwd: repo.root });

	const first = pi.commands.get("diff-review").handler("", ctx);
	await startupEntered;
	const second = pi.commands.get("diff-review").handler("", ctx);
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(createdServerCount, 1);
	releaseStartup();
	await Promise.all([first, second]);
	assert.equal(createdServerCount, 1);
});

test("session shutdown closes active diff review sessions for the Pi session key", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const pi = createFakePi();
	let shutdowns = 0;
	createDiffReviewExtension({
		startServer: async () => ({ baseUrl: "http://127.0.0.1:4321", close: async () => {} }),
		shutdownSessionsForPiSessionKey: async () => {
			shutdowns += 1;
		},
	})(pi);
	const ctx = makeCommandContext({ piSessionKey: "s1", cwd: repo.root });

	await pi.commands.get("diff-review").handler("", ctx);
	await pi.events.get("session_shutdown")({}, ctx);

	assert.equal(shutdowns, 1);
});

test("shutdown cleanup continues past close failures and removes all sessions", async () => {
	const closed = [];
	const detached = [];
	const removed = [];
	await assert.rejects(
		() => shutdownSessionsForPiSessionKey(
			{
				listByPiSessionKey() {
					return [{ reviewSessionId: "a" }, { reviewSessionId: "b" }];
				},
				emitSessionClosed() {},
				getServer(reviewSessionId) {
					return {
						async close() {
							closed.push(reviewSessionId);
							if (reviewSessionId === "a") throw new Error("close failed");
						},
					};
				},
				detachServer(reviewSessionId) {
					detached.push(reviewSessionId);
				},
				remove(reviewSessionId) {
					removed.push(reviewSessionId);
				},
			},
			"s1",
		),
		/close failed/i,
	);
	assert.deepEqual(closed, ["a", "b"]);
	assert.deepEqual(detached, ["a", "b"]);
	assert.deepEqual(removed, ["a", "b"]);
});

test("reply tool accepts thread target with path and optional line reference", async () => {
	const store = createReviewSessionStore();
	const session = store.create(makeSessionSeed());
	const result = await recordReply(store, {
		reviewSessionId: session.reviewSessionId,
		submissionRoundId: "round-1",
		threadId: "thread-1",
		path: "src/a.ts",
		line: { startLine: 4, endLine: 6, targetSide: "new" },
		reply: "Looks good",
	});
	assert.equal(result.path, "src/a.ts");
	assert.equal(result.line?.startLine, 4);
});

test("reply tool rejects malformed or unknown payloads", async () => {
	const store = createReviewSessionStore();
	const session = store.create(makeSessionSeed());
	await assert.rejects(() => recordReply(store, { reviewSessionId: "wrong", submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /review session/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "wrong", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /submission round/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", path: "src/a.ts", reply: "x" }), /threadId or commentId/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", commentId: "comment-1", path: "src/a.ts", reply: "x" }), /exactly one/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "missing", path: "src/a.ts", reply: "x" }), /thread/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", commentId: "missing", path: "src/a.ts", reply: "x" }), /comment/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-2", path: "src/b.ts", reply: "x" }), /active round/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", reply: "x" }), /path/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "" }), /reply/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", line: { startLine: 6, endLine: 4, targetSide: "new" }, reply: "x" }), /line/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/other.ts", reply: "x" }), /path/i);
	await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", line: { startLine: 9, endLine: 10, targetSide: "new" }, reply: "x" }), /line/i);
});
