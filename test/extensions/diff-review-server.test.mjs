import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";

import { createReviewSessionStore } from "../../pi-extension/diff-review/state.ts";
import { startReviewServer } from "../../pi-extension/diff-review/server.ts";

class UnexpectedHeadError extends Error {
	constructor() {
		super("unexpected HEAD explosion");
	}
}

const execFileAsync = promisify(execFile);

async function run(command, args, cwd) {
	return execFileAsync(command, args, { cwd, encoding: "utf8" });
}

async function createTempRepoFixture(options = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "diff-review-server-"));
	await run("git", ["init", "-q"], root);
	await run("git", ["config", "user.email", "test@example.com"], root);
	await run("git", ["config", "user.name", "Diff Review Test"], root);

	const repo = {
		root,
		async write(filePath, content) {
			const absolutePath = path.join(root, filePath);
			await mkdir(path.dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, content);
		},
		async commit(message) {
			await run("git", ["add", "-A"], root);
			await run("git", ["commit", "-qm", message], root);
		},
		async git(...args) {
			return run("git", args, root);
		},
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		},
	};

	if (!options.noHeadCommit) {
		await repo.write("src/a.ts", "export const a = 1;\n");
		await repo.commit("initial");
	}

	if (options.detached && !options.noHeadCommit) {
		await repo.git("checkout", "--detach");
	}

	return repo;
}

function makeReviewSession(repoRoot) {
	const store = createReviewSessionStore();
	const session = store.create({
		piSessionKey: "s1",
		repoRoot,
		serverSecret: "secret-1",
		diffMode: "working-tree-vs-head",
		files: [{ path: "src/a.ts" }],
		threads: [
			{
				id: "thread-1",
				path: "src/a.ts",
				root: {
					id: "comment-1",
					path: "src/a.ts",
					body: "Please review this",
					status: "open",
					line: { startLine: 1, endLine: 1, targetSide: "new" },
				},
				replies: [],
			},
		],
	});
	return { store, session };
}

async function startTestServer(repoRoot, overrides = {}) {
	const { store, session } = makeReviewSession(repoRoot);
	const sentPrompts = [];
	const sendUserMessage = overrides.sendUserMessage ?? (async (prompt) => {
		sentPrompts.push(prompt);
	});
	const server = await startReviewServer(session, {
		store,
		isPiIdle: overrides.isPiIdle ?? (() => true),
		sendUserMessage,
		readFileImpl: overrides.readFileImpl,
		createDiffProvider: overrides.createDiffProvider,
		beforeSubmit: overrides.beforeSubmit,
	});
	return { ...server, store, session, sentPrompts };
}

async function getJson(response) {
	return { status: response.status, body: await response.json() };
}

async function postJson(url, body = {}) {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const req = httpRequest(
			{
				hostname: target.hostname,
				port: target.port,
				path: `${target.pathname}${target.search}`,
				method: "POST",
				headers: { "content-type": "application/json" },
				agent: false,
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode,
						body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null,
					});
				});
			},
		);
		req.on("error", reject);
		req.end(JSON.stringify(body));
	});
}

test("server binds to loopback and rejects missing secret", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root);
	t.after(() => started.close());

	assert.match(started.baseUrl, /^http:\/\/127\.0\.0\.1:/);
	const response = await fetch(`${started.baseUrl}/api/session`);
	assert.equal(response.status, 403);
});

test("submit rejects while the Pi session is busy before mutating state", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root, { isPiIdle: () => false });
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/submit?secret=${started.session.serverSecret}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	assert.equal(response.status, 409);
	assert.equal(started.session.pendingSubmission, null);
});

test("concurrent submit requests do not inject the same round twice", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	let releaseFirstSubmit;
	let signalFirstSubmitEntered;
	const firstSubmitBlocked = new Promise((resolve) => {
		releaseFirstSubmit = resolve;
	});
	const firstSubmitEntered = new Promise((resolve) => {
		signalFirstSubmitEntered = resolve;
	});
	let beforeSubmitCalls = 0;
	const sentPrompts = [];
	const started = await startTestServer(repo.root, {
		beforeSubmit: async () => {
			beforeSubmitCalls += 1;
			if (beforeSubmitCalls === 1) {
				signalFirstSubmitEntered();
				await firstSubmitBlocked;
			}
		},
		sendUserMessage: async (prompt) => {
			sentPrompts.push(prompt);
		},
	});
	t.after(() => started.close());

	const submitUrl = `${started.baseUrl}/api/submit?secret=${started.session.serverSecret}`;
	const first = postJson(submitUrl, {});
	await firstSubmitEntered;
	const second = postJson(submitUrl, {});
	await new Promise((resolve) => setTimeout(resolve, 25));
	releaseFirstSubmit();
	const [firstResponse, secondResponse] = await Promise.all([first, second]);
	const statuses = [firstResponse.status, secondResponse.status].sort();
	assert.deepEqual(statuses, [200, 409]);
	assert.equal(beforeSubmitCalls, 1);
	assert.equal(sentPrompts.length, 1);
	assert.equal(started.session.pendingSubmission?.id, "round-1");
});

test("completing a Pi round clears pending state and enables another submit", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root);
	t.after(() => started.close());

	const first = await fetch(`${started.baseUrl}/api/submit?secret=${started.session.serverSecret}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	assert.equal(first.status, 200);
	assert.ok(started.session.pendingSubmission);

	const complete = await fetch(`${started.baseUrl}/api/rounds/${started.session.pendingSubmission.id}/complete?secret=${started.session.serverSecret}`, {
		method: "POST",
	});
	assert.equal(complete.status, 200);
	assert.equal(started.session.pendingSubmission, null);

	const next = await fetch(`${started.baseUrl}/api/submit?secret=${started.session.serverSecret}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	assert.equal(next.status, 200);
});

test("diff-mode switch falls back to working-tree mode when merge-base fails", async (t) => {
	const repo = await createTempRepoFixture({ detached: true });
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root);
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/diff-mode?secret=${started.session.serverSecret}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ requestedMode: "merge-base-vs-head" }),
	});
	const result = await getJson(response);
	assert.equal(result.status, 200);
	assert.equal(result.body.requestedMode, "merge-base-vs-head");
	assert.equal(result.body.effectiveMode, "working-tree-vs-head");
	assert.match(result.body.warning, /merge-base/i);
});

test("server returns clear repo error when cwd is not a git repo", async (t) => {
	const notRepo = await mkdtemp(path.join(tmpdir(), "diff-review-not-repo-"));
	t.after(() => rm(notRepo, { recursive: true, force: true }));
	const started = await startTestServer(notRepo);
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/session?secret=${started.session.serverSecret}`);
	const result = await getJson(response);
	assert.equal(result.status, 400);
	assert.match(result.body.error, /git repo/i);
});

test("server does not classify unexpected HEAD errors as bootstrap errors", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root, {
		createDiffProvider: async () => {
			throw new UnexpectedHeadError();
		},
	});
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/session?secret=${started.session.serverSecret}`);
	const result = await getJson(response);
	assert.equal(result.status, 500);
	assert.match(result.body.error, /unexpected HEAD explosion/);
});

test("server surfaces unreadable file payloads without crashing", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	await repo.write("secret.txt", "top secret\n");
	await repo.commit("add secret");
	const started = await startTestServer(repo.root, {
		readFileImpl(filePath) {
			if (filePath.endsWith(`${path.sep}secret.txt`)) {
				throw Object.assign(new Error("permission denied"), { code: "EACCES" });
			}
			return readFile(filePath);
		},
	});
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/file?secret=${started.session.serverSecret}&path=${encodeURIComponent("secret.txt")}`);
	const result = await getJson(response);
	assert.equal(result.status, 200);
	assert.equal(result.body.loadError.code, "unreadable");
});

test("server startup reports port conflicts clearly", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const busyPortServer = createNetServer();
	await new Promise((resolve, reject) => busyPortServer.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
	t.after(() => busyPortServer.close());
	const port = busyPortServer.address().port;
	const { session, store } = makeReviewSession(repo.root);

	await assert.rejects(
		() => startReviewServer(session, {
			store,
			port,
			isPiIdle: () => true,
			sendUserMessage: async () => {},
		}),
		/port/i,
	);
});

test("SSE emits reply and session-state events", async (t) => {
	const repo = await createTempRepoFixture();
	t.after(() => repo.cleanup());
	const started = await startTestServer(repo.root);
	t.after(() => started.close());

	const response = await fetch(`${started.baseUrl}/api/events?secret=${started.session.serverSecret}`);
	assert.equal(response.status, 200);
	const reader = response.body.getReader();
	const events = [];
	let buffered = "";
	const readUntil = async (count) => {
		while (events.length < count) {
			const { value, done } = await reader.read();
			assert.equal(done, false);
			buffered += Buffer.from(value).toString("utf8");
			let index = buffered.indexOf("\n\n");
			while (index >= 0) {
				const block = buffered.slice(0, index);
				buffered = buffered.slice(index + 2);
				const event = /event: (.+)/.exec(block)?.[1];
				const data = /data: (.+)/.exec(block)?.[1];
				if (event && data) events.push({ event, data: JSON.parse(data) });
				index = buffered.indexOf("\n\n");
			}
		}
	};

	await fetch(`${started.baseUrl}/api/submit?secret=${started.session.serverSecret}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	await fetch(`${started.baseUrl}/api/rounds/${started.session.pendingSubmission.id}/complete?secret=${started.session.serverSecret}`, {
		method: "POST",
	});
	await started.store.appendReply({
		reviewSessionId: started.session.reviewSessionId,
		submissionRoundId: started.session.submissionHistory[0].id,
		threadId: "thread-1",
		path: "src/a.ts",
		reply: "Looks good",
	});

	await readUntil(3);
	assert.ok(events.some((event) => event.event === "session-state" && event.data.pendingSubmission?.id === "round-1"));
	assert.ok(events.some((event) => event.event === "session-state" && event.data.pendingSubmission === null));
	assert.ok(events.some((event) => event.event === "reply" && event.data.reply === "Looks good"));
	await reader.cancel();
});
