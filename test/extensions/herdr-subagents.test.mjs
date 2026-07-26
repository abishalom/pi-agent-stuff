import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import packageJson from "../../package.json" with { type: "json" };
import { loadAgentCatalog } from "../../pi-extension/herdr-subagents/agents.ts";
import {
	buildDeliveryMessage,
	DeliveryScheduler,
	MAX_PARENT_MESSAGE_BYTES,
} from "../../pi-extension/herdr-subagents/delivery.ts";
import {
	chooseSplitDirection,
	CliHerdrClient,
	controlNameFor,
	parsePaneInfo,
} from "../../pi-extension/herdr-subagents/herdr.ts";
import {
	createHerdrSubagentsExtension,
	HerdrSubagentsRuntime,
} from "../../pi-extension/herdr-subagents/index.ts";
import { SubagentMonitorManager } from "../../pi-extension/herdr-subagents/monitor.ts";
import { IncrementalSessionReader, SessionReaderStore } from "../../pi-extension/herdr-subagents/session-reader.ts";
import { parseSubagentCommand, registerSubagentsUI } from "../../pi-extension/herdr-subagents/ui.ts";

const ROOT = join(import.meta.dirname, "../..");
const BUNDLED = join(ROOT, "pi-extension/herdr-subagents/agents");
const POLICY = join(ROOT, "config/subagent-model-overrides.json");
const BUILTIN_TOOLS = ["read", "bash", "write", "edit"];

async function temporaryDirectory() {
	return mkdtemp(join(tmpdir(), "herdr-subagents-test-"));
}

function assistantEntry(id, stopReason, text, extra = {}) {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: text === undefined ? [] : [{ type: "text", text }],
			provider: "test-provider",
			model: "test-model",
			stopReason,
			timestamp: Date.now(),
			...extra,
		},
	};
}

function jsonLine(value) {
	return `${JSON.stringify(value)}\n`;
}

test("manifest replaces upstream subagents and declares runtime schema dependency", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/herdr-subagents/index.ts"));
	assert.ok(!packageJson.dependencies["pi-interactive-subagents"]);
	assert.equal(packageJson.dependencies.typebox, "^1.3.7");
	assert.ok(!packageJson.pi.extensions.some((value) => value.includes("subagent-model-overrides")));
});

test("bundled catalog resolves exactly four adapted roles and model policy", () => {
	const catalog = loadAgentCatalog({
		cwd: ROOT,
		trusted: false,
		bundledDir: BUNDLED,
		policyPath: POLICY,
		parentThinking: "minimal",
		availableTools: BUILTIN_TOOLS,
		globalAgentsDir: join(ROOT, "does-not-exist"),
	});
	assert.deepEqual(catalog.definitions.map((item) => item.name), ["explorer", "planner", "reviewer", "worker"]);
	assert.equal(catalog.get("EXPLORER").thinking, "low");
	assert.equal(catalog.get("explorer").placement, "tab");
	assert.match(catalog.get("worker").body, /Nested delegation is unavailable/i);
	assert.match(catalog.get("worker").body, /hunk session comment list/i);
	assert.match(catalog.get("reviewer").body, /hunk skill path/i);
	assert.match(catalog.get("reviewer").body, /type user/i);
	assert.equal(catalog.diagnostics.length, 0);
});

test("catalog enforces trust, precedence, duplicate diagnostics, and tool validation", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const bundled = join(root, "bundled");
	const global = join(root, "global");
	const project = join(root, ".pi/agents");
	await Promise.all([
		import("node:fs/promises").then(({ mkdir }) => Promise.all([
			mkdir(bundled, { recursive: true }), mkdir(global, { recursive: true }), mkdir(project, { recursive: true }),
		])),
	]);
	const definition = (name, description, tools = "read") => `---\nname: ${name}\ndescription: ${description}\nmodel: p/m\ntools: ${tools}\n---\nPrompt body`;
	await writeFile(join(bundled, "x.md"), definition("x", "bundled"));
	await writeFile(join(global, "x.md"), definition("x", "global"));
	await writeFile(join(project, "x.md"), definition("x", "project"));
	await writeFile(join(project, "bad.md"), definition("bad", "bad", "missing"));
	let catalog = loadAgentCatalog({ cwd: root, trusted: false, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.equal(catalog.get("x").description, "global");
	assert.equal(catalog.get("bad"), undefined);
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.equal(catalog.get("x").description, "project");
	assert.match(catalog.diagnostics.find((item) => item.name === "bad").message, /unknown tools/);
	await writeFile(join(project, "x-duplicate.md"), definition("X", "duplicate"));
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.equal(catalog.get("x"), undefined);
	assert.equal(catalog.diagnostics.filter((item) => item.name === "x").length, 2);
});

test("split geometry follows deterministic thresholds", () => {
	assert.equal(chooseSplitDirection({ width: 144, height: 54 }), "right");
	assert.equal(chooseSplitDirection({ width: 100, height: 40 }), "down");
	assert.equal(chooseSplitDirection({ width: 119, height: 31 }), null);
	assert.equal(chooseSplitDirection({ width: 120, height: 20 }), "right");
});

test("Herdr pane parsing treats IDs as opaque and derives strict control names", () => {
	const pane = parsePaneInfo({
		pane_id: "workspace:pA9", tab_id: "workspace:tZ", workspace_id: "workspace",
		agent_status: "done", state_change_seq: 42,
		agent_session: { value: "/tmp/session.jsonl" },
	});
	assert.equal(pane.paneId, "workspace:pA9");
	assert.equal(pane.status, "done");
	assert.equal(pane.sessionPath, "/tmp/session.jsonl");
	assert.match(controlNameFor("Code Reviewer", pane.paneId), /^[a-z0-9-]+$/);
});

test("CLI adapter validates anchored integration status and uses atomic prompt wait", async () => {
	const calls = [];
	const pi = {
		async exec(command, args) {
			calls.push([command, ...args]);
			if (args[0] === "--version") return { stdout: "herdr 0.7.5\n", stderr: "", code: 0, killed: false };
			if (args[0] === "integration") return { stdout: "pi: current (v6) (/tmp/integration.ts)\n", stderr: "", code: 0, killed: false };
			return {
				stdout: JSON.stringify({ result: { agent: { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "working" } } }),
				stderr: "", code: 0, killed: false,
			};
		},
	};
	const client = new CliHerdrClient(pi);
	await client.validate();
	await client.prompt("w1:p2", "A != B");
	const prompt = calls.find((call) => call[1] === "agent" && call[2] === "prompt");
	assert.deepEqual(prompt.slice(0, 5), ["herdr", "agent", "prompt", "w1:p2", "A != B"]);
	assert.ok(prompt.includes("--wait"));
	assert.ok(prompt.includes("working"));
});

test("CLI adapter reads structured Herdr errors from stderr and retries a newly-created busy pane", async () => {
	let starts = 0;
	const pi = {
		async exec(_command, args) {
			if (args[0] === "agent" && args[1] === "start" && starts++ === 0) {
				return {
					stdout: "",
					stderr: JSON.stringify({ error: { code: "agent_pane_busy", message: "agent target pane w1:p2 is not an available shell" } }),
					code: 1,
					killed: false,
				};
			}
			return {
				stdout: JSON.stringify({ result: { agent: {
					pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "idle",
					interactive_ready: true, agent_session: { value: "/tmp/child.jsonl" },
				} } }),
				stderr: "",
				code: 0,
				killed: false,
			};
		},
	};
	const client = new CliHerdrClient(pi);
	const pane = await client.startPi({ paneId: "w1:p2", controlName: "reviewer-w1-p2", args: [], timeoutMs: 1000 });
	assert.equal(pane.status, "idle");
	assert.equal(starts, 2);
});

test("CLI adapter waits for complete Pi session metadata after agent start succeeds", async () => {
	let starts = 0;
	let gets = 0;
	const getTimeouts = [];
	const pane = (extra = {}) => ({
		pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "idle", ...extra,
	});
	const pi = {
		async exec(_command, args, options) {
			if (args[0] === "agent" && args[1] === "start") {
				starts += 1;
				return {
					stdout: JSON.stringify({ result: { agent: pane({ interactive_ready: false }) } }),
					stderr: "", code: 0, killed: false,
				};
			}
			if (args[0] === "agent" && args[1] === "get") {
				gets += 1;
				getTimeouts.push(options.timeout);
				if (gets === 1) {
					return {
						stdout: "",
						stderr: JSON.stringify({ error: { code: "agent_not_found", message: "Pi detection is pending" } }),
						code: 1, killed: false,
					};
				}
				const metadata = gets === 2
					? { agent_session: { value: "/tmp/path-only.jsonl" } }
					: gets === 3
						? { interactive_ready: true }
						: { interactive_ready: true, agent_session: { value: "/tmp/detected-child.jsonl" } };
				return {
					stdout: JSON.stringify({ result: { agent: pane(metadata) } }),
					stderr: "", code: 0, killed: false,
				};
			}
			throw new Error(`Unexpected Herdr command: ${args.join(" ")}`);
		},
	};
	const client = new CliHerdrClient(pi);
	const started = await client.startPi({ paneId: "w1:p2", controlName: "reviewer-w1-p2", args: [], timeoutMs: 10000 });
	assert.equal(started.sessionPath, "/tmp/detected-child.jsonl");
	assert.equal(started.interactiveReady, true);
	assert.equal(starts, 1);
	assert.equal(gets, 4);
	assert.ok(getTimeouts.every((timeout) => timeout > 0 && timeout <= 5000));
});

test("CLI adapter bounds missing Pi session metadata by the startup deadline", async () => {
	let starts = 0;
	let gets = 0;
	const pi = {
		async exec(_command, args, options) {
			if (args[0] === "agent" && args[1] === "start") {
				starts += 1;
				return {
					stdout: JSON.stringify({ result: { agent: {
						pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "idle",
						interactive_ready: false,
					} } }),
					stderr: "", code: 0, killed: false,
				};
			}
			gets += 1;
			assert.ok(options.timeout > 0 && options.timeout <= 20);
			return {
				stdout: "",
				stderr: JSON.stringify({ error: { code: "agent_not_found", message: "Pi detection is pending" } }),
				code: 1, killed: false,
			};
		},
	};
	const client = new CliHerdrClient(pi);
	await assert.rejects(
		() => client.startPi({ paneId: "w1:p2", controlName: "reviewer-w1-p2", args: [], timeoutMs: 20 }),
		/sessionPath=missing, interactiveReady=false, status=idle/,
	);
	const getsAtTimeout = gets;
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(gets, getsAtTimeout);
	assert.equal(starts, 1);
});

test("CLI adapter aborts session metadata polling without another agent start", async () => {
	const controller = new AbortController();
	let starts = 0;
	let gets = 0;
	const pi = {
		async exec(_command, args) {
			if (args[0] === "agent" && args[1] === "start") {
				starts += 1;
				return {
					stdout: JSON.stringify({ result: { agent: {
						pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_status: "idle",
						interactive_ready: false,
					} } }),
					stderr: "", code: 0, killed: false,
				};
			}
			gets += 1;
			controller.abort(new Error("startup cancelled"));
			return {
				stdout: "",
				stderr: JSON.stringify({ error: { code: "agent_not_found", message: "Pi detection is pending" } }),
				code: 1, killed: false,
			};
		},
	};
	const client = new CliHerdrClient(pi);
	await assert.rejects(
		() => client.startPi({ paneId: "w1:p2", controlName: "reviewer-w1-p2", args: [], timeoutMs: 10000 }, controller.signal),
		/startup cancelled/,
	);
	assert.equal(starts, 1);
	assert.equal(gets, 1);
});

test("CLI adapter rejects startup metadata for a different pane", async () => {
	const pi = {
		async exec() {
			return {
				stdout: JSON.stringify({ result: { agent: {
					pane_id: "w1:p9", tab_id: "w1:t9", workspace_id: "w1", agent_status: "idle",
					interactive_ready: true, agent_session: { value: "/tmp/wrong-child.jsonl" },
				} } }),
				stderr: "", code: 0, killed: false,
			};
		},
	};
	const client = new CliHerdrClient(pi);
	await assert.rejects(
		() => client.startPi({ paneId: "w1:p2", controlName: "reviewer-w1-p2", args: [], timeoutMs: 1000 }),
		/returned pane w1:p9 while starting child pane w1:p2/,
	);
});

test("session reader accepts Pi's reserved path before the JSONL file is created", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "not-created-yet.jsonl");
	const reader = new IncrementalSessionReader(path);
	await reader.baseline();
	await writeFile(path, jsonLine(assistantEntry("first", "stop", "created after prompt")));
	const results = await reader.scanUnseen();
	assert.deepEqual(results.map((item) => item.text), ["created after prompt"]);
});

test("incremental session reader baselines history and handles partial UTF-8 plus ordered finals", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "session.jsonl");
	await writeFile(path, jsonLine(assistantEntry("old", "stop", "historical")));
	const reader = new IncrementalSessionReader(path);
	await reader.baseline();
	assert.deepEqual(await reader.scanUnseen(), []);

	const partial = Buffer.from(jsonLine(assistantEntry("emoji", "stop", "hello 🙂")), "utf8");
	const emojiStart = partial.indexOf(Buffer.from("🙂"));
	const cut = emojiStart + 2;
	await appendFile(path, partial.subarray(0, cut));
	assert.deepEqual(await reader.scanUnseen(), []);
	await appendFile(path, partial.subarray(cut));
	await appendFile(path, jsonLine(assistantEntry("length", "length", "partial answer")));
	await appendFile(path, jsonLine(assistantEntry("tool", "toolUse", "not final")));
	const results = await reader.scanUnseen();
	assert.deepEqual(results.map((item) => [item.entryId, item.classification, item.text]), [
		["emoji", "success", "hello 🙂"],
		["length", "incomplete", "partial answer"],
	]);
	assert.deepEqual(await reader.scanUnseen(), []);
});

test("session reader attributes aborted results only to the interrupted turn", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "session.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const reader = new IncrementalSessionReader(path);
	const cursor = await reader.messageCursor();
	await appendFile(path, jsonLine(assistantEntry("abort", "aborted", "stopped")));
	let [result] = await reader.scanUnseen(true, cursor);
	assert.equal(result.classification, "interrupted");

	const nextCursor = await reader.messageCursor();
	await appendFile(path, jsonLine({ type: "message", id: "direct-user", message: { role: "user", content: [{ type: "text", text: "next" }] } }));
	await appendFile(path, jsonLine(assistantEntry("direct-abort", "aborted", "stopped again")));
	[result] = await reader.scanUnseen(true, nextCursor);
	assert.equal(result.classification, "failure");
});

test("session reader baselines historical results and same-path replacements", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "session.jsonl");
	await writeFile(path, jsonLine(assistantEntry("historical", "stop", "old")));
	const reader = new IncrementalSessionReader(path);
	await reader.baseline();
	assert.equal(await reader.latest(), undefined);

	await appendFile(path, jsonLine(assistantEntry("fresh", "stop", "fresh")));
	assert.equal((await reader.scanUnseen()).at(-1).text, "fresh");
	assert.equal((await reader.latest()).text, "fresh");

	await writeFile(path, jsonLine(assistantEntry("replacement-history", "stop", "replacement old")));
	assert.deepEqual(await reader.scanUnseen(), []);
	assert.equal(await reader.latest(), undefined);
	await appendFile(path, jsonLine(assistantEntry("replacement-fresh", "stop", "replacement fresh")));
	assert.equal((await reader.scanUnseen()).at(-1).text, "replacement fresh");

	const swapped = join(root, "swapped.jsonl");
	await writeFile(swapped, jsonLine(assistantEntry("inode-history", "stop", "inode old")));
	await rename(swapped, path);
	assert.deepEqual(await reader.scanUnseen(), []);
	assert.equal(await reader.latest(), undefined);
	await appendFile(path, jsonLine(assistantEntry("inode-fresh", "stop", "inode fresh")));
	assert.equal((await reader.scanUnseen()).at(-1).text, "inode fresh");
});

test("delivery message caps valid UTF-8 without duplicating response text in details", () => {
	const text = "🙂".repeat(MAX_PARENT_MESSAGE_BYTES);
	const message = buildDeliveryMessage([{
		kind: "completion", paneId: "w1:p2", label: "[E] Explorer", agentName: "explorer",
		model: "p/m", elapsedMs: 1000, text, sessionPath: "/tmp/session.jsonl", classification: "success",
	}]);
	assert.ok(Buffer.byteLength(message.content, "utf8") <= MAX_PARENT_MESSAGE_BYTES);
	assert.equal(message.content.includes("�"), false);
	assert.equal(Object.hasOwn(message.details.events[0], "text"), false);
	assert.equal(message.details.events[0].truncated, true);
});

test("delivery scheduler preserves events that do not fit in the first capped message", async () => {
	const sent = [];
	const scheduler = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	scheduler.setContext({ isIdle: () => true });
	const large = "🙂".repeat(MAX_PARENT_MESSAGE_BYTES);
	for (const paneId of ["p1", "p2"]) {
		scheduler.enqueue({ kind: "completion", paneId, label: paneId, agentName: "explorer", model: "p/m", elapsedMs: 1, text: large });
	}
	await new Promise((resolve) => setTimeout(resolve, 15));
	assert.equal(sent.length, 2);
	assert.deepEqual(sent.map((message) => message.details.events[0].paneId), ["p1", "p2"]);
	assert.ok(sent.every((message) => Buffer.byteLength(message.content, "utf8") <= MAX_PARENT_MESSAGE_BYTES));
	scheduler.shutdown();
});

test("delivery scheduler coalesces events and waits for parent settlement", async () => {
	const sent = [];
	let idle = false;
	const scheduler = new DeliveryScheduler({ sendMessage(message, options) { sent.push({ message, options }); } }, 5);
	const ctx = { isIdle: () => idle };
	scheduler.setContext(ctx);
	const event = (paneId) => ({ kind: "completion", paneId, label: paneId, agentName: "explorer", model: "p/m", elapsedMs: 1, text: paneId });
	scheduler.enqueue(event("p1"));
	scheduler.enqueue(event("p2"));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 0);
	idle = true;
	scheduler.parentSettled(ctx);
	await new Promise((resolve) => setTimeout(resolve, 15));
	assert.equal(sent.length, 1);
	assert.equal(sent[0].message.details.events.length, 2);
	assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
	scheduler.shutdown();
});

test("get_subagent_result tool always exposes child status with its latest result", async () => {
	const tools = new Map();
	const pi = {
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
	};
	const controller = {
		getCatalog() { return { definitions: [], diagnostics: [], get() {} }; },
		async getResult() { return { status: "working", result: { text: "previous result", classification: "success" } }; },
	};
	registerSubagentsUI(pi, controller);
	const result = await tools.get("get_subagent_result").execute("call", { paneId: "w1:p2" });
	assert.match(result.content[0].text, /w1:p2: working/);
	assert.match(result.content[0].text, /previous result/);
});

test("command parser supports placement, --, and rejects ambiguous options", () => {
	assert.deepEqual(parseSubagentCommand("reviewer --placement split Review the diff"), {
		agent: "reviewer", placement: "split", task: "Review the diff",
	});
	assert.deepEqual(parseSubagentCommand("explorer -- --placement is task text"), {
		agent: "explorer", task: "--placement is task text",
	});
	assert.throws(() => parseSubagentCommand("worker --placement tab --placement split task"), /Duplicate/);
	assert.throws(() => parseSubagentCommand("worker --unknown task"), /Unknown/);
});

class LifecycleHerdrClient {
	status = "working";
	stateChangeSeq = 10;
	fastPrompts = false;
	alive = true;
	paneAlive = true;
	prompts = [];
	escapes = 0;
	waiters = [];
	sessionPath;
	constructor(sessionPath) { this.sessionPath = sessionPath; }
	info() { return { paneId: "w1:p2", tabId: "w1:t2", workspaceId: "w1", status: this.status, stateChangeSeq: this.stateChangeSeq, sessionPath: this.sessionPath }; }
	async getAgent() { return this.alive ? this.info() : null; }
	async getPane() { return this.paneAlive ? this.info() : null; }
	async waitAgent(_paneId, statuses, _timeout, signal) {
		if (statuses.includes(this.status)) return this.info();
		return new Promise((resolve) => {
			const waiter = { statuses, resolve };
			this.waiters.push(waiter);
			signal?.addEventListener("abort", () => resolve(null), { once: true });
		});
	}
	setStatus(status) {
		if (this.status !== status) this.stateChangeSeq += 1;
		this.status = status;
		const waiting = this.waiters.splice(0);
		for (const waiter of waiting) {
			if (waiter.statuses.includes(status)) waiter.resolve(this.info());
			else this.waiters.push(waiter);
		}
	}
	closePane() {
		this.alive = false;
		this.paneAlive = false;
		for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
	}
	async prompt(_paneId, message) {
		this.prompts.push(message);
		if (this.fastPrompts) {
			this.stateChangeSeq += 2;
			this.status = "idle";
		} else {
			this.setStatus("working");
		}
		return this.info();
	}
	async sendEscape() { this.escapes += 1; }
}

function trackedChild(sessionPath, status = "working") {
	return {
		paneId: "w1:p2", tabId: "w1:t2", workspaceId: "w1", agentName: "explorer",
		agentSourcePath: "/tmp/explorer.md", label: "[E] Explorer", placement: "tab",
		model: "p/m", thinking: "low", tools: ["read"], sessionPath, status,
		queuedFollowups: [], startedAt: Date.now(), turnStartedAt: Date.now(),
		monitorAbort: new AbortController(), generation: 1,
	};
}

test("monitor delivers JSONL completion even when working transition was missed", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	await appendFile(path, jsonLine(assistantEntry("done", "stop", "final result")));
	const sent = [];
	const delivery = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	delivery.setContext({ isIdle: () => true });
	const client = new LifecycleHerdrClient(path);
	client.status = "idle";
	const manager = new SubagentMonitorManager(client, delivery, readers);
	manager.track(trackedChild(path));
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(sent.length, 1);
	assert.match(sent[0].content, /final result/);
	manager.shutdown();
	delivery.shutdown();
});

test("monitor drains one FIFO follow-up per settlement and protects blocked children", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	const delivery = new DeliveryScheduler({ sendMessage() {} }, 1);
	delivery.setContext({ isIdle: () => true });
	const client = new LifecycleHerdrClient(path);
	const manager = new SubagentMonitorManager(client, delivery, readers);
	const child = trackedChild(path);
	manager.track(child);
	assert.equal((await manager.followup(child.paneId, "first")).queued, true);
	assert.equal((await manager.followup(child.paneId, "second")).queued, true);
	client.setStatus("idle");
	await new Promise((resolve) => setTimeout(resolve, 15));
	assert.deepEqual(client.prompts, ["first"]);
	client.setStatus("idle");
	await new Promise((resolve) => setTimeout(resolve, 15));
	assert.deepEqual(client.prompts, ["first", "second"]);
	client.setStatus("blocked");
	const interrupted = await manager.interrupt(child.paneId);
	assert.equal(interrupted.interrupted, false);
	assert.equal(client.escapes, 0);
	const blocked = await manager.followup(child.paneId, "third");
	assert.equal(blocked.blocked, true);
	manager.shutdown();
	delivery.shutdown();
});

test("monitor drains FIFO follow-ups when prompt reports a fast settled turn", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	const delivery = new DeliveryScheduler({ sendMessage() {} }, 1);
	delivery.setContext({ isIdle: () => true });
	const client = new LifecycleHerdrClient(path);
	client.fastPrompts = true;
	const manager = new SubagentMonitorManager(client, delivery, readers);
	const child = trackedChild(path);
	manager.track(child);
	await manager.followup(child.paneId, "first");
	await manager.followup(child.paneId, "second");
	client.setStatus("idle");
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.deepEqual(client.prompts, ["first", "second"]);
	manager.shutdown();
	delivery.shutdown();
});

test("monitor delivers a final JSONL result before reporting child exit", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	const sent = [];
	const delivery = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	delivery.setContext({ isIdle: () => true });
	const client = new LifecycleHerdrClient(path);
	const manager = new SubagentMonitorManager(client, delivery, readers);
	manager.track(trackedChild(path));
	await appendFile(path, jsonLine(assistantEntry("final-before-exit", "stop", "complete before exit")));
	client.alive = false;
	for (const waiter of client.waiters.splice(0)) waiter.resolve(null);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sent.length, 1);
	assert.match(sent[0].content, /complete before exit/);
	assert.doesNotMatch(sent[0].content, /exited before/i);
	manager.shutdown();
	delivery.shutdown();
});

test("monitor reports a pane closed during active work once", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	const sent = [];
	const delivery = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	delivery.setContext({ isIdle: () => true });
	const client = new LifecycleHerdrClient(path);
	const manager = new SubagentMonitorManager(client, delivery, readers);
	manager.track(trackedChild(path));
	await new Promise((resolve) => setTimeout(resolve, 5));
	client.closePane();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sent.length, 1);
	assert.match(sent[0].content, /closed/i);
	manager.shutdown();
	delivery.shutdown();
});

class FakeHerdrClient {
	calls = [];
	sessionPath;
	status = "working";
	constructor(sessionPath) { this.sessionPath = sessionPath; }
	async validate() { this.calls.push(["validate"]); }
	async currentPane() { return { paneId: "w1:p1", tabId: "w1:t1", workspaceId: "w1", status: "idle" }; }
	async paneRect() { return { width: 144, height: 54 }; }
	async createTab(input) { this.calls.push(["createTab", input]); return { paneId: "w1:p2", tabId: "w1:t2", workspaceId: "w1", placement: "tab" }; }
	async createSplit(input) { this.calls.push(["createSplit", input]); return { paneId: "w1:p3", tabId: "w1:t1", workspaceId: "w1", placement: "split" }; }
	async renamePane(...args) { this.calls.push(["renamePane", ...args]); }
	async renameTab(...args) { this.calls.push(["renameTab", ...args]); }
	async reportRole(...args) { this.calls.push(["reportRole", ...args]); }
	async startPi(input) { this.calls.push(["startPi", input]); return { paneId: input.paneId, tabId: input.paneId === "w1:p2" ? "w1:t2" : "w1:t1", workspaceId: "w1", status: "idle", sessionPath: this.sessionPath, interactiveReady: true }; }
	async prompt(paneId, message) { this.calls.push(["prompt", paneId, message]); this.status = "working"; return { paneId, tabId: "w1:t2", workspaceId: "w1", status: "working", sessionPath: this.sessionPath, stateChangeSeq: 7 }; }
	async getAgent(paneId) { return { paneId, tabId: "w1:t2", workspaceId: "w1", status: this.status, sessionPath: this.sessionPath, stateChangeSeq: 7 }; }
	async getPane(paneId) { return { paneId, tabId: "w1:t2", workspaceId: "w1", status: "unknown" }; }
	async waitAgent(_paneId, _statuses, _timeout, signal) {
		return new Promise((resolve) => signal?.addEventListener("abort", () => resolve(null), { once: true }));
	}
	async sendEscape() { this.calls.push(["escape"]); }
}

function fakePi() {
	return {
		sent: [],
		getThinkingLevel: () => "low",
		getAllTools: () => BUILTIN_TOOLS.map((name) => ({ name })),
		sendMessage(message, options) { this.sent.push({ message, options }); },
	};
}

function fakeContext() {
	const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
	return {
		mode: "tui",
		cwd: ROOT,
		isProjectTrusted: () => false,
		isIdle: () => true,
		modelRegistry: {
			find(provider, id) { return { ...model, provider, id }; },
			async getApiKeyAndHeaders() { return { ok: true, apiKey: "test" }; },
		},
		ui: { notify() {} },
	};
}

test("runtime launches a default tab, waits for prompt submission, cleans prompt file, and enforces ownership", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const sessionPath = join(root, "child.jsonl");
	await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const client = new FakeHerdrClient(sessionPath);
	const pi = fakePi();
	const runtime = new HerdrSubagentsRuntime(pi, {
		clientFactory: () => client,
		bundledDir: BUNDLED,
		policyPath: POLICY,
		globalAgentsDir: join(root, "global"),
		env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
		debounceMs: 1,
	});
	const ctx = fakeContext();
	runtime.startSession(ctx);
	const child = await runtime.launch({ agent: "explorer", task: "Find auth entry points" }, ctx);
	assert.equal(child.placement, "tab");
	assert.equal(child.paneId, "w1:p2");
	assert.ok(client.calls.some(([name]) => name === "createTab"));
	assert.ok(client.calls.some(([name, , message]) => name === "prompt" && message === "Find auth entry points"));
	const start = client.calls.find(([name]) => name === "startPi")[1];
	assert.ok(start.args.includes("--append-system-prompt"));
	const promptPath = start.args[start.args.indexOf("--append-system-prompt") + 1];
	assert.equal(existsSync(promptPath), false);
	await assert.rejects(() => runtime.followup("w1:not-owned", "hello"), /not a child owned/);
	await assert.rejects(() => runtime.interrupt("w1:not-owned"), /not a child owned/);
	await assert.rejects(() => runtime.getResult("w1:not-owned"), /not a child owned/);
	runtime.shutdown();
});

test("runtime fails model authentication before creating a surface", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const client = new FakeHerdrClient(join(root, "unused.jsonl"));
	const pi = fakePi();
	const runtime = new HerdrSubagentsRuntime(pi, {
		clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
		globalAgentsDir: join(root, "global"), env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
	});
	const ctx = fakeContext();
	ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "missing test credential" });
	runtime.startSession(ctx);
	await assert.rejects(() => runtime.launch({ agent: "explorer", task: "inspect" }, ctx), /missing test credential/);
	assert.equal(client.calls.some(([name]) => name === "createTab" || name === "createSplit"), false);
	runtime.shutdown();
});

test("runtime honors explicit split placement and deterministic direction", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const sessionPath = join(root, "child.jsonl");
	await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const client = new FakeHerdrClient(sessionPath);
	const runtime = new HerdrSubagentsRuntime(fakePi(), {
		clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
		globalAgentsDir: join(root, "global"), env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
	});
	const ctx = fakeContext();
	runtime.startSession(ctx);
	const child = await runtime.launch({ agent: "reviewer", task: "review", placement: "split" }, ctx);
	assert.equal(child.placement, "split");
	const split = client.calls.find(([name]) => name === "createSplit");
	assert.equal(split[1].direction, "right");
	runtime.shutdown();
});

test("startup metadata timeout leaves the surface address, skips prompting, and removes the private prompt file", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const client = new FakeHerdrClient(join(root, "unused.jsonl"));
	let promptPath;
	client.startPi = async (input) => {
		promptPath = input.args[input.args.indexOf("--append-system-prompt") + 1];
		throw new Error("Herdr started Pi, but sessionPath=missing and interactiveReady=false at the startup deadline");
	};
	const runtime = new HerdrSubagentsRuntime(fakePi(), {
		clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
		globalAgentsDir: join(root, "global"), env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
	});
	const ctx = fakeContext();
	runtime.startSession(ctx);
	await assert.rejects(
		() => runtime.launch({ agent: "explorer", task: "inspect" }, ctx),
		/sessionPath=missing.*interactiveReady=false.*w1:p2/,
	);
	assert.equal(client.calls.some(([name]) => name === "prompt"), false);
	assert.equal(existsSync(promptPath), false);
	runtime.shutdown();
});

test("child marker disables every orchestration registration", () => {
	const registered = [];
	const pi = {
		registerTool(tool) { registered.push(tool.name); },
		registerCommand(name) { registered.push(name); },
		registerMessageRenderer(name) { registered.push(name); },
		on(name) { registered.push(name); },
	};
	createHerdrSubagentsExtension({ env: { PI_HERDR_SUBAGENT: "1" } })(pi);
	assert.deepEqual(registered, []);
});
