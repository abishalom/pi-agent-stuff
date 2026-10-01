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
	MAX_AUTOMATIC_HANDOFF_BYTES,
	MAX_PARENT_MESSAGE_BYTES,
	pruneDigestedDeliveryMessages,
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

const contextEntry = (data) => ({ type: "custom", customType: "herdr-subagent-context", data });
const compactionEntry = (id, outcome = "success", extra = {}) => ({
	type: "custom", id, customType: "herdr-subagent-compaction",
	data: { timestamp: new Date().toISOString(), outcome, reason: "manual", willRetry: false, fromExtension: false, ...extra },
});

test("compaction CLI submission is no-wait, normalized, cancellable, and does not require a pane result", async () => {
	const calls = [];
	const client = new CliHerdrClient({ async exec(command, args, options) {
		calls.push({ command, args, options });
		return { code: 0, stdout: JSON.stringify({ result: { accepted: true } }), stderr: "" };
	} });
	const signal = new AbortController().signal;
	await client.requestCompaction("p:2", "  preserve\n decisions\r\n and\t paths  ", signal);
	await client.requestCompaction("p:2", " \n ");
	await client.requestCompaction("p:2");
	assert.deepEqual(calls.map((call) => call.args), [
		["agent", "prompt", "p:2", "/compact preserve decisions and paths"],
		["agent", "prompt", "p:2", "/compact"],
		["agent", "prompt", "p:2", "/compact"],
	]);
	assert.equal(calls[0].options.signal, signal);
});

test("compaction requires an owned live settled child and neither interrupts nor queues", async (t) => {
	const client = new LifecycleHerdrClient();
	const requests = [];
	client.requestCompaction = async (...args) => requests.push(args);
	const delivery = new DeliveryScheduler({ sendMessage() {} });
	const manager = new SubagentMonitorManager(client, delivery);
	t.after(() => { manager.shutdown(); delivery.shutdown(); });
	const child = trackedChild(undefined);
	manager.track(child);
	await assert.rejects(() => manager.compact("foreign"), /not a child owned/);
	for (const status of ["working", "blocked", "unknown"]) {
		client.status = status;
		await assert.rejects(() => manager.compact(child.paneId), /requires idle\/settled/);
	}
	for (const status of ["idle", "done"]) {
		client.status = status;
		assert.deepEqual(await manager.compact(child.paneId, "retain paths"), { paneId: child.paneId, requested: true });
	}
	child.queuedFollowups.push("pending");
	await assert.rejects(() => manager.compact(child.paneId), /queued follow-ups/);
	child.queuedFollowups.length = 0;
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(() => manager.compact(child.paneId, undefined, abort.signal));
	child.status = "exited";
	await assert.rejects(() => manager.compact(child.paneId), /exited/);
	child.status = "settled";
	client.alive = false;
	await assert.rejects(() => manager.compact(child.paneId), /no longer running/);
	assert.equal(requests.length, 2);
	assert.ok(requests[0][2] instanceof AbortSignal);
	assert.equal(client.escapes, 0);
	assert.deepEqual(client.prompts, []);
	assert.deepEqual(child.queuedFollowups, []);
});

test("status exposes latest timestamped child snapshot, preserves unknowns, and resets on replacement", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "context.jsonl");
	const readers = new SessionReaderStore();
	assert.equal(await readers.get(path).latestContext(), null);
	const snapshot = { timestamp: "2026-07-15T12:00:00.000Z", reason: "agent_settled", tokens: 45000, contextWindow: 100000, percent: 45, model: "p/m" };
	await writeFile(path, jsonLine(contextEntry(snapshot)));
	await readers.get(path).baseline();
	const delivery = new DeliveryScheduler({ sendMessage() {} });
	const client = new LifecycleHerdrClient(path);
	client.status = "idle";
	const manager = new SubagentMonitorManager(client, delivery, readers);
	t.after(() => { manager.shutdown(); delivery.shutdown(); });
	manager.track(trackedChild(path));
	assert.deepEqual(await manager.status("w1:p2"), { paneId: "w1:p2", status: "idle", contextSource: "last-reported", context: snapshot });
	await assert.rejects(() => manager.status("foreign"), /not a child owned/);
	const unknown = { ...snapshot, reason: "session_compact", tokens: null, percent: null };
	await appendFile(path, jsonLine(contextEntry(unknown)));
	assert.deepEqual((await manager.status("w1:p2")).context, unknown);
	await appendFile(path, jsonLine({ ...contextEntry(snapshot), type: "custom_message" }) + jsonLine({ type: "usage", usage: { totalTokens: 999999 } }));
	assert.deepEqual(await readers.get(path).latestContext(), unknown);
	await appendFile(path, jsonLine(contextEntry({ ...snapshot, tokens: 0, percent: 0 })));
	assert.equal((await readers.get(path).latestContext()).percent, 0);
	await appendFile(path, jsonLine(contextEntry({ timestamp: snapshot.timestamp, reason: "model_select" })));
	assert.deepEqual(await readers.get(path).latestContext(), { timestamp: snapshot.timestamp, reason: "model_select", tokens: null, contextWindow: null, percent: null, model: null });
	await appendFile(path, jsonLine(contextEntry({ ...snapshot, timestamp: "invalid" })));
	assert.equal((await readers.get(path).latestContext()).tokens, null);
	const replacement = join(root, "replacement");
	await writeFile(replacement, jsonLine({ type: "session" }));
	await rename(replacement, path);
	assert.equal(await readers.get(path).latestContext(), null);
});

test("leaf children report context without delegation, including compaction and model changes", () => {
	const handlers = new Map();
	const entries = [];
	const pi = { ...fakePi(), registerMessageRenderer() {}, on(name, handler) { handlers.set(name, handler); },
		appendEntry(customType, data) { entries.push({ customType, data }); } };
	createHerdrSubagentsExtension({ env: { PI_HERDR_SUBAGENT: "1", PI_HERDR_DELEGATES: "0" } })(pi);
	let usage = { tokens: 45000, contextWindow: 100000, percent: 45 };
	const ctx = { ...fakeContext(), model: { provider: "p", id: "m" }, getContextUsage: () => usage };
	handlers.get("session_start")({}, ctx);
	handlers.get("agent_settled")({}, ctx);
	usage = { tokens: null, contextWindow: 100000, percent: null };
	handlers.get("session_compact")({ reason: "manual", willRetry: false, fromExtension: false }, ctx);
	handlers.get("session_compact_failed")({ reason: "threshold", aborted: false, errorMessage: "Provider unavailable", willRetry: false, fromExtension: false }, ctx);
	handlers.get("session_compact_failed")({ reason: "overflow", aborted: true, willRetry: true, fromExtension: true }, ctx);
	usage = undefined;
	handlers.get("model_select")({}, ctx);
	handlers.get("session_tree")({}, ctx);
	const outcomes = entries.filter((entry) => entry.customType === "herdr-subagent-compaction");
	assert.deepEqual(outcomes.map((entry) => entry.data.outcome), ["success", "failure", "aborted"]);
	assert.deepEqual(outcomes.map((entry) => entry.data.reason), ["manual", "threshold", "overflow"]);
	assert.equal(outcomes[1].data.errorMessage, "Provider unavailable");
	assert.equal(outcomes[2].data.willRetry, true);
	entries.splice(0, entries.length, ...entries.filter((entry) => entry.customType === "herdr-subagent-context"));
	assert.deepEqual(entries.map((entry) => entry.data.reason), ["session_start", "agent_settled", "session_compact", "model_select", "session_tree"]);
	assert.ok(entries.every((entry) => entry.customType === "herdr-subagent-context" && Number.isFinite(Date.parse(entry.data.timestamp))));
	assert.equal(entries[1].data.percent, 45);
	assert.equal(entries[2].data.tokens, null);
	assert.equal(entries[3].data.contextWindow, null);
	handlers.get("session_shutdown")();
});

test("new control tools forward cancellation and give honest compaction/context guidance", async () => {
	const tools = new Map();
	const signal = new AbortController().signal;
	const calls = [];
	registerSubagentsUI({ registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {} }, {
		async compact(...args) { calls.push(args); return { paneId: args[0], requested: true }; },
		async status(...args) { calls.push(args); return { paneId: args[0], status: "idle", contextSource: "last-reported", context: null }; },
	});
	const result = await tools.get("subagent_compact").execute("id", { paneId: "p2", instructions: "retain paths" }, signal);
	assert.deepEqual(calls[0], ["p2", "retain paths", signal]);
	assert.match(result.content[0].text, /completion is not confirmed/);
	const status = await tools.get("subagent_status").execute("id", { paneId: "p2" }, signal);
	assert.deepEqual(calls[1], ["p2", signal]);
	assert.equal(status.details.context, null);
	assert.match(tools.get("subagent").promptGuidelines.join(" "), /under 40%.*soft target/);
});

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

test("manifest replaces upstream subagents and uses the host-provided schema package", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/herdr-subagents/index.ts"));
	assert.ok(!packageJson.dependencies["pi-interactive-subagents"]);
	assert.equal(packageJson.dependencies.typebox, undefined);
	assert.equal(packageJson.peerDependencies.typebox, "*");
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
	assert.deepEqual(catalog.get("worker").delegates, ["explorer"]);
	assert.deepEqual(catalog.get("planner").delegates, ["explorer"]);
	assert.deepEqual(catalog.get("explorer").delegates, []);
	assert.deepEqual(catalog.get("reviewer").delegates, []);
	assert.match(catalog.get("worker").body, /hunk session comment list/i);
	assert.match(catalog.get("reviewer").body, /hunk skill path/i);
	assert.match(catalog.get("reviewer").body, /type user/i);
	assert.equal(catalog.diagnostics.length, 0);
});

test("bundled defaults and model policy select GPT-6.1 Sol while preserving thinking levels and Luna", () => {
	for (const policyPath of [POLICY, join(ROOT, "does-not-exist.json")]) {
		const catalog = loadAgentCatalog({
			cwd: ROOT,
			trusted: false,
			bundledDir: BUNDLED,
			policyPath,
			parentThinking: "minimal",
			availableTools: BUILTIN_TOOLS,
			globalAgentsDir: join(ROOT, "does-not-exist"),
		});
		for (const [role, thinking] of [["planner", "high"], ["worker", "medium"], ["reviewer", "high"]]) {
			assert.equal(catalog.get(role).model, "openai-codex/gpt-6.1-sol");
			assert.equal(catalog.get(role).thinking, thinking);
		}
		assert.equal(catalog.get("explorer").model, "openai-codex/gpt-6-luna");
		assert.equal(catalog.get("explorer").thinking, "low");
		assert.equal(catalog.diagnostics.length, 0);
	}
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
	assert.deepEqual(catalog.get("x").delegates, []);
	assert.equal(catalog.get("bad"), undefined);
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.equal(catalog.get("x").description, "project");
	assert.match(catalog.diagnostics.find((item) => item.name === "bad").message, /unknown tools/);
	await writeFile(join(project, "x-duplicate.md"), definition("X", "duplicate"));
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.equal(catalog.get("x"), undefined);
	assert.equal(catalog.diagnostics.filter((item) => item.name === "x").length, 2);
	await writeFile(join(project, "bad-delegates.md"), definition("bad-delegates", "invalid").replace("tools: read", "tools: read\ndelegates: not a role"));
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read"] });
	assert.match(catalog.diagnostics.find((item) => item.name === "bad-delegates").message, /delegates must/);
	for (const tool of ["subagent_compact", "subagent_status"]) {
		await writeFile(join(project, `${tool}.md`), definition(tool, "invalid", tool));
	}
	catalog = loadAgentCatalog({ cwd: root, trusted: true, bundledDir: bundled, globalAgentsDir: global, policyPath: join(root, "none.json"), parentThinking: "low", availableTools: ["read", "subagent_compact", "subagent_status"] });
	for (const tool of ["subagent_compact", "subagent_status"]) {
		assert.equal(catalog.get(tool), undefined);
		assert.match(catalog.diagnostics.find((item) => item.name === tool).message, /nested orchestration tools are unavailable/);
	}
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

test("session reader serializes concurrent refresh and delivery operations", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "session.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const reader = new IncrementalSessionReader(path);
	await reader.baseline();
	await appendFile(path, jsonLine(assistantEntry("a", "stop", "first")));
	const latest = await Promise.all([reader.latest(), reader.latest()]);
	assert.deepEqual(latest.map((result) => result.entryId), ["a", "a"]);
	await appendFile(path, jsonLine(assistantEntry("b", "stop", "second")));
	assert.deepEqual((await reader.scanUnseen()).map((result) => result.entryId), ["a", "b"]);
	await appendFile(path, jsonLine(assistantEntry("c", "stop", "third")));
	const concurrentScans = await Promise.all([reader.scanUnseen(), reader.scanUnseen()]);
	assert.deepEqual(concurrentScans.flat().map((result) => result.entryId), ["c"]);
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

test("delivery message creates a compact valid-UTF-8 handoff without duplicating response text in details", () => {
	const text = "🙂".repeat(MAX_PARENT_MESSAGE_BYTES);
	const message = buildDeliveryMessage([{
		kind: "completion", paneId: "w1:p2", entryId: "result-1", label: "[E] Explorer", agentName: "explorer",
		model: "p/m", elapsedMs: 1000, text, sessionPath: "/tmp/session.jsonl", classification: "success",
	}]);
	assert.ok(Buffer.byteLength(message.content, "utf8") <= MAX_AUTOMATIC_HANDOFF_BYTES + 256);
	assert.ok(Buffer.byteLength(message.content, "utf8") <= MAX_PARENT_MESSAGE_BYTES);
	assert.equal(message.content.includes("�"), false);
	assert.match(message.content, /get_subagent_result/);
	assert.equal(Object.hasOwn(message.details.events[0], "text"), false);
	assert.equal(message.details.events[0].entryId, "result-1");
	assert.equal(message.details.events[0].truncated, true);
});

test("delivery scheduler preserves events that do not fit in the first capped message", async () => {
	const sent = [];
	const scheduler = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	scheduler.setContext({ isIdle: () => true });
	const large = "🙂".repeat(MAX_PARENT_MESSAGE_BYTES);
	for (const paneId of ["p1", "p2", "p3", "p4"]) {
		scheduler.enqueue({ kind: "completion", paneId, label: paneId, agentName: "explorer", model: "p/m", elapsedMs: 1, text: large });
	}
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sent.length, 2);
	assert.deepEqual(sent.flatMap((message) => message.details.events.map((event) => event.paneId)), ["p1", "p2", "p3", "p4"]);
	assert.ok(sent.every((message) => Buffer.byteLength(message.content, "utf8") <= MAX_PARENT_MESSAGE_BYTES));
	scheduler.shutdown();
});

test("delivery scheduler cancels a queued result and reports only actually delivered entries", async () => {
	const sent = [];
	const delivered = [];
	let idle = false;
	const scheduler = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	scheduler.setDeliveredListener((events) => delivered.push(...events));
	const ctx = { isIdle: () => idle };
	scheduler.setContext(ctx);
	scheduler.enqueue({ kind: "completion", paneId: "p1", entryId: "r1", label: "p1", agentName: "explorer", model: "p/m", elapsedMs: 1, text: "full result" });
	assert.equal(scheduler.cancelQueuedResult("p1", "r1"), true);
	idle = true;
	scheduler.parentSettled(ctx);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 0);
	assert.equal(delivered.length, 0);
	scheduler.shutdown();
});

test("context pruning keeps a handoff through retryable attempts and drops it after a successful parent response", () => {
	const delivery = { role: "custom", customType: "herdr-subagent-events", content: "handoff" };
	const toolUse = { role: "assistant", stopReason: "toolUse" };
	const failed = { role: "assistant", stopReason: "error" };
	const final = { role: "assistant", stopReason: "stop" };
	assert.deepEqual(pruneDigestedDeliveryMessages([delivery, toolUse]), [delivery, toolUse]);
	assert.deepEqual(pruneDigestedDeliveryMessages([delivery, failed]), [delivery, failed]);
	assert.deepEqual(pruneDigestedDeliveryMessages([delivery, toolUse, final]), [toolUse, final]);
	const newer = { ...delivery, content: "newer" };
	assert.deepEqual(pruneDigestedDeliveryMessages([delivery, final, newer]), [final, newer]);
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

test("subagent launch instructs the parent to yield instead of polling", async () => {
	const tools = new Map();
	registerSubagentsUI({
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
	}, {
		getCatalog() { return { definitions: [], diagnostics: [], get() {} }; },
		async launch() {
			return {
				label: "[E] Explorer: inspect", placement: "tab", paneId: "w1:p2", tabId: "w1:t2",
				agentName: "explorer", model: "p/m", thinking: "low", sessionPath: "/tmp/child.jsonl",
			};
		},
		async followup() {},
		async interrupt() {},
		async getResult() {},
	});
	const tool = tools.get("subagent");
	assert.match(tool.description, /end the current turn immediately/i);
	assert.match(tool.description, /do not poll with sleep, herdr pane read, or loops/i);
	assert.match(tool.promptSnippet, /finish this turn/i);
	assert.match(tool.promptSnippet, /child emits a handoff/i);
	const result = await tool.execute("call", { agent: "explorer", task: "Inspect the code" }, undefined, undefined, {});
	assert.match(result.content[0].text, /Do not poll; finish this turn\. You will be resumed automatically when the child emits a handoff\./);
});

test("/subagent command forwards parsed launch overrides", async () => {
	let command;
	let launched;
	const notifications = [];
	registerSubagentsUI({ registerTool() {}, registerCommand(_name, value) { command = value; } }, {
		async launch(input) { launched = input; return { label: "Worker", paneId: "w1:p2" }; },
	});
	await command.handler("worker --model p/m --thinking high Task", { ui: { notify(...args) { notifications.push(args); } } });
	assert.deepEqual(launched, { agent: "worker", task: "Task", model: "p/m", thinking: "high" });
	assert.match(notifications[0][0], /Started Worker/);
});

test("subagent tool exposes model and thinking overrides and returns resolved child metadata", async () => {
	const tools = new Map();
	let received;
	registerSubagentsUI({ registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {} }, {
		async launch(input) {
			received = input;
			return { label: "Worker", paneId: "w1:p2", tabId: "w1:t2", agentName: "worker", placement: "tab",
				model: input.model, thinking: input.thinking, sessionPath: "/tmp/child.jsonl" };
		},
	});
	const tool = tools.get("subagent");
	assert.ok(tool.parameters.properties.model);
	assert.ok(tool.parameters.properties.thinking);
	const result = await tool.execute("call", { agent: "worker", task: "Task", model: "p/m", thinking: "high" }, undefined, undefined, {});
	assert.equal(received.model, "p/m");
	assert.equal(received.thinking, "high");
	assert.equal(result.details.model, "p/m");
	assert.equal(result.details.thinking, "high");
});

test("get_subagent_result exposes bounded content once without copying response text into details", async () => {
	const tools = new Map();
	const pi = {
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
	};
	let calls = 0;
	const controller = {
		getCatalog() { return { definitions: [], diagnostics: [], get() {} }; },
		async getResult() {
			calls += 1;
			return calls === 1
				? { status: "working", entryId: "r1", result: { entryId: "r1", text: "previous result ".repeat(1000), classification: "success" } }
				: { status: "working", entryId: "r1", alreadyRetrieved: true };
		},
	};
	registerSubagentsUI(pi, controller);
	const tool = tools.get("get_subagent_result");
	const result = await tool.execute("call", { paneId: "w1:p2", maxBytes: 1024 });
	assert.match(result.content[0].text, /w1:p2: working/);
	assert.match(result.content[0].text, /previous result/);
	assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 1024);
	assert.equal(Object.hasOwn(result.details.result, "text"), false);
	const repeated = await tool.execute("call-2", { paneId: "w1:p2" });
	assert.match(repeated.content[0].text, /already retrieved; not repeating/i);
});

test("get_subagent_result preserves failures that have no assistant text", async () => {
	const tools = new Map();
	registerSubagentsUI({
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
	}, {
		getCatalog() { return { definitions: [], diagnostics: [], get() {} }; },
		async getResult() {
			return { status: "completed", entryId: "failed", result: {
				entryId: "failed", text: "", classification: "failure", errorMessage: "credentials expired",
			} };
		},
	});
	const result = await tools.get("get_subagent_result").execute("call", { paneId: "w1:p2" });
	assert.match(result.content[0].text, /credentials expired/);
});

test("command parser supports placement, model, thinking, --, and rejects ambiguous options", () => {
	assert.deepEqual(parseSubagentCommand("reviewer --placement split Review the diff"), {
		agent: "reviewer", placement: "split", task: "Review the diff",
	});
	assert.deepEqual(parseSubagentCommand("explorer -- --placement is task text"), {
		agent: "explorer", task: "--placement is task text",
	});
	assert.throws(() => parseSubagentCommand("worker --placement tab --placement split task"), /Duplicate/);
	assert.deepEqual(parseSubagentCommand("worker --model openai-codex/gpt-6.0-astra --thinking high --placement tab Task"), {
		agent: "worker", model: "openai-codex/gpt-6.0-astra", thinking: "high", placement: "tab", task: "Task",
	});
	assert.deepEqual(parseSubagentCommand("worker --thinking off -- --model ignored"), {
		agent: "worker", thinking: "off", task: "--model ignored",
	});
	for (const option of ["model", "thinking", "placement"]) {
		const value = { model: "p/m", thinking: "high", placement: "tab" }[option];
		assert.throws(() => parseSubagentCommand(`worker --${option} ${value} --${option} ${value} Task`), /Duplicate/);
		assert.throws(() => parseSubagentCommand(`worker --${option} -- Task`), new RegExp(`Missing value for --${option}`));
		assert.throws(() => parseSubagentCommand(`worker --${option}`), new RegExp(`Missing value for --${option}`));
	}
	assert.throws(() => parseSubagentCommand("worker --model short Task"), /provider\/model/);
	assert.throws(() => parseSubagentCommand("worker --model p//m Task"), /provider\/model/);
	assert.throws(() => parseSubagentCommand("worker --model p/m/ Task"), /provider\/model/);
	assert.throws(() => parseSubagentCommand("worker --thinking extreme Task"), /Invalid --thinking/);
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
		queuedFollowups: [], resultDeliveryStates: new Map(), startedAt: Date.now(), turnStartedAt: Date.now(),
		monitorAbort: new AbortController(), generation: 1,
	};
}

test("compaction reader baselines history, deduplicates concurrent scans, and keeps results independent", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "events.jsonl");
	await writeFile(path, jsonLine(compactionEntry("historical")));
	const reader = new IncrementalSessionReader(path);
	await reader.baseline();
	assert.deepEqual(await reader.scanUnseenCompactions(), []);
	const fresh = compactionEntry("fresh");
	await appendFile(path, jsonLine(fresh) + jsonLine(fresh) + jsonLine(assistantEntry("result", "stop", "response"))
		+ jsonLine({ type: "compaction", id: "summary", summary: "not a response" })
		+ jsonLine({ ...compactionEntry("not-custom"), type: "custom_message" })
		+ jsonLine(compactionEntry("invalid", "success", { reason: "bogus" })));
	await reader.latestContext();
	assert.equal((await reader.latest()).text, "response");
	assert.equal((await reader.scanUnseen()).length, 1);
	const scans = await Promise.all([reader.scanUnseenCompactions(), reader.scanUnseenCompactions()]);
	assert.deepEqual(scans.flat().map((event) => event.entryId), ["fresh"]);
	const replacement = join(root, "replacement");
	await writeFile(replacement, jsonLine(compactionEntry("replacement-history")));
	await rename(replacement, path);
	assert.deepEqual(await reader.scanUnseenCompactions(), []);
	await appendFile(path, jsonLine(compactionEntry("new-after-replace", "aborted")));
	assert.equal((await reader.scanUnseenCompactions())[0].outcome, "aborted");
});

for (const outcome of ["success", "failure", "aborted"]) {
	test(`compaction ${outcome} hook wakes idle parent even without a child lifecycle transition`, async (t) => {
		const root = await temporaryDirectory();
		t.after(() => rm(root, { recursive: true, force: true }));
		const path = join(root, "child.jsonl");
		await writeFile(path, "");
		const readers = new SessionReaderStore();
		await readers.get(path).baseline();
		const sent = [];
		const delivery = new DeliveryScheduler({ sendMessage(message, options) { sent.push({ message, options }); } }, 1);
		delivery.setContext({ isIdle: () => true });
		const client = new LifecycleHerdrClient(path);
		client.status = "idle";
		const manager = new SubagentMonitorManager(client, delivery, readers);
		t.after(() => { manager.shutdown(); delivery.shutdown(); });
		const child = trackedChild(path, "settled");
		manager.track(child);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const handlers = new Map();
		const entries = [];
		createHerdrSubagentsExtension({ env: { PI_HERDR_SUBAGENT: "1", PI_HERDR_DELEGATES: "0" } })({
			...fakePi(), registerMessageRenderer() {}, on(name, handler) { handlers.set(name, handler); },
			appendEntry(customType, data) { entries.push({ type: "custom", id: `hook-${entries.length}`, customType, data }); },
		});
		const event = { reason: "manual", willRetry: false, fromExtension: false, aborted: outcome === "aborted", errorMessage: outcome === "failure" ? "Provider unavailable" : undefined };
		handlers.get(outcome === "success" ? "session_compact" : "session_compact_failed")(event, { getContextUsage: () => undefined });
		await appendFile(path, entries.map(jsonLine).join(""));
		// Simulate the existing monitor wait timeout, not a status transition.
		for (const waiter of client.waiters.splice(0)) waiter.resolve(client.info());
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(sent.length, 1);
		assert.equal(sent[0].options.triggerTurn, true);
		assert.equal(sent[0].message.details.events[0].compaction.outcome, outcome);
		assert.match(sent[0].message.content, outcome === "success" ? /succeeded.*manual/ : outcome === "failure" ? /failed.*Provider unavailable/ : /canceled or aborted/);
		assert.equal(child.latestResult, undefined);
		assert.equal(child.resultDeliveryStates.size, 0);
		handlers.get("session_shutdown")();
	});
}

test("busy parent defers compaction delivery; status/result retrieval cannot consume it; exit scans final events", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, "");
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	const sent = [];
	let idle = false;
	const ctx = { isIdle: () => idle };
	const delivery = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	delivery.setContext(ctx);
	const client = new LifecycleHerdrClient(path);
	client.status = "idle";
	const manager = new SubagentMonitorManager(client, delivery, readers);
	t.after(() => { manager.shutdown(); delivery.shutdown(); });
	const child = trackedChild(path, "settled");
	manager.track(child);
	await new Promise((resolve) => setTimeout(resolve, 10));
	await appendFile(path, jsonLine(assistantEntry("response", "stop", "assistant answer")) + jsonLine(compactionEntry("compact")));
	assert.equal((await manager.getResult(child.paneId)).result.text, "assistant answer");
	await manager.status(child.paneId);
	for (const waiter of client.waiters.splice(0)) waiter.resolve(client.info());
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 0);
	assert.equal(child.latestResult.text, "assistant answer");
	idle = true;
	delivery.parentSettled(ctx);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 1);
	assert.equal(sent[0].details.events.length, 1);
	assert.equal(sent[0].details.events[0].kind, "compaction_success");
	await appendFile(path, jsonLine(compactionEntry("final", "failure", { errorMessage: "Provider failed" })));
	client.alive = false;
	for (const waiter of client.waiters.splice(0)) waiter.resolve(null);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sent.length, 2);
	assert.match(sent[1].content, /Provider failed/);
	assert.equal(child.status, "exited");
});

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

test("explicit result retrieval cancels a queued handoff and suppresses repeated full output", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "child.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	const readers = new SessionReaderStore();
	await readers.get(path).baseline();
	await appendFile(path, jsonLine(assistantEntry("done", "stop", "full final result")));
	const sent = [];
	let idle = false;
	const ctx = { isIdle: () => idle };
	const delivery = new DeliveryScheduler({ sendMessage(message) { sent.push(message); } }, 1);
	delivery.setContext(ctx);
	const client = new LifecycleHerdrClient(path);
	client.status = "idle";
	const manager = new SubagentMonitorManager(client, delivery, readers);
	const child = trackedChild(path);
	manager.track(child);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(child.resultDeliveryStates.get("done"), "queued");
	const retrieved = await manager.getResult(child.paneId);
	assert.equal(retrieved.result.text, "full final result");
	assert.equal(retrieved.automaticHandoffCancelled, true);
	assert.equal(child.resultDeliveryStates.get("done"), "retrieved");
	idle = true;
	delivery.parentSettled(ctx);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 0);
	const repeated = await manager.getResult(child.paneId);
	assert.equal(repeated.alreadyRetrieved, true);
	assert.equal(repeated.result, undefined);
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
	const model = { provider: "openai-codex", id: "gpt-6-luna", reasoning: true };
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
	assert.deepEqual(client.calls.find(([name]) => name === "createTab")[1].env,
		{ PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: "explorer", PI_HERDR_DEPTH: "1", PI_HERDR_DELEGATES: "0" });
	assert.ok(client.calls.some(([name]) => name === "createTab"));
	assert.ok(client.calls.some(([name, , message]) => name === "prompt" && message === "Find auth entry points"));
	const start = client.calls.find(([name]) => name === "startPi")[1];
	assert.ok(start.args.includes("--append-system-prompt"));
	assert.equal(start.args[start.args.indexOf("--model") + 1], child.model);
	assert.equal(start.args[start.args.indexOf("--thinking") + 1], child.thinking);
	assert.equal(child.model, runtime.getCatalog().get("explorer").model);
	assert.equal(child.thinking, runtime.getCatalog().get("explorer").thinking);
	const promptPath = start.args[start.args.indexOf("--append-system-prompt") + 1];
	assert.equal(existsSync(promptPath), false);
	await assert.rejects(() => runtime.followup("w1:not-owned", "hello"), /not a child owned/);
	await assert.rejects(() => runtime.interrupt("w1:not-owned"), /not a child owned/);
	await assert.rejects(() => runtime.getResult("w1:not-owned"), /not a child owned/);
	runtime.shutdown();
});

test("runtime resolves independent and combined launch overrides without changing catalog defaults", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const sessionPath = join(root, "child.jsonl");
	await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	for (const overrides of [{ model: "openai-codex/gpt-6.0-astra" }, { thinking: "high" }, { model: "openai-codex/gpt-6.0-astra", thinking: "off" }]) {
		const client = new FakeHerdrClient(sessionPath);
		const runtime = new HerdrSubagentsRuntime(fakePi(), {
			clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
			globalAgentsDir: join(root, "global"), env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
		});
		const ctx = fakeContext();
		runtime.startSession(ctx);
		const defaults = runtime.getCatalog().get("worker");
		const child = await runtime.launch({ agent: "worker", task: "Task", ...overrides }, ctx);
		const args = client.calls.find(([name]) => name === "startPi")[1].args;
		assert.equal(child.model, overrides.model ?? defaults.model);
		assert.equal(client.calls.find(([name]) => name === "createTab")[1].env.PI_HERDR_DELEGATES, "1");
		for (const name of ["subagent", "subagent_compact", "subagent_status"]) {
			assert.ok(args[args.indexOf("--tools") + 1].split(",").includes(name));
		}
		assert.equal(child.thinking, overrides.thinking ?? defaults.thinking);
		assert.equal(args[args.indexOf("--model") + 1], child.model);
		assert.equal(args[args.indexOf("--thinking") + 1], child.thinking);
		assert.equal(runtime.getCatalog().get("worker").model, defaults.model);
		assert.equal(runtime.getCatalog().get("worker").thinking, defaults.thinking);
		runtime.shutdown();
	}
});

test("runtime reports Pi's effective thinking level when the selected model clamps the request", async (t) => {
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
	ctx.modelRegistry.find = (provider, id) => ({ provider, id, reasoning: false });
	runtime.startSession(ctx);
	const child = await runtime.launch({ agent: "worker", task: "Task", model: "test/plain", thinking: "high" }, ctx);
	const args = client.calls.find(([name]) => name === "startPi")[1].args;
	assert.equal(child.model, "test/plain");
	assert.equal(child.thinking, "off");
	assert.equal(args[args.indexOf("--thinking") + 1], "off");
	assert.equal(runtime.getCatalog().get("worker").thinking, "medium");
	runtime.shutdown();
});

test("runtime rejects invalid thinking and unconfigured, malformed or unauthenticated override models before surface creation", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const client = new FakeHerdrClient(join(root, "unused.jsonl"));
	const runtime = new HerdrSubagentsRuntime(fakePi(), {
		clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
		globalAgentsDir: join(root, "global"), env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" },
	});
	const ctx = fakeContext();
	ctx.modelRegistry.find = (provider, id) => id === "unavailable" ? undefined : { provider, id, reasoning: true };
	ctx.modelRegistry.getApiKeyAndHeaders = async (model) => model.id === "no-auth"
		? { ok: false, error: "missing key" } : { ok: true, apiKey: "test" };
	runtime.startSession(ctx);
	for (const [overrides, message] of [
		[{ thinking: "extreme" }, /Invalid subagent thinking level/],
		[{ model: "invalid" }, /expected provider\/model/],
		[{ model: "p/" }, /expected provider\/model/],
		[{ model: "p/unavailable" }, /not configured/],
		[{ model: "p/no-auth" }, /missing key/],
	]) {
		await assert.rejects(() => runtime.launch({ agent: "worker", task: "Task", ...overrides }, ctx), message);
		assert.equal(client.calls.some(([name]) => name === "createTab" || name === "createSplit"), false);
	}
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
	assert.equal(split[1].env.PI_HERDR_DEPTH, "1");
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

test("child sessions initialize delivery but register orchestration only when delegating below max depth", () => {
	for (const [env, expected] of [
		[{ PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: "explorer", PI_HERDR_DEPTH: "1", PI_HERDR_DELEGATES: "0" }, false],
		[{ PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: "worker", PI_HERDR_DEPTH: "1", PI_HERDR_DELEGATES: "1" }, true],
		[{ PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: "worker", PI_HERDR_DEPTH: "2", PI_HERDR_DELEGATES: "1" }, false],
	]) {
		const registered = [];
		const pi = {
			registerTool(tool) { registered.push(tool.name); },
			registerCommand(name) { registered.push(name); },
			registerMessageRenderer(name) { registered.push(name); },
			on(name) { registered.push(name); },
		};
		createHerdrSubagentsExtension({ env })(pi);
		assert.equal(registered.includes("subagent"), expected);
		assert.equal(registered.includes("subagent_compact"), expected);
		assert.equal(registered.includes("subagent_status"), expected);
		assert.ok(registered.includes("session_compact"));
		assert.ok(registered.includes("session_compact_failed"));
		assert.ok(registered.includes("session_start"));
		assert.ok(registered.includes("agent_settled"));
		assert.ok(registered.includes("context"));
	}
});

test("nested launch enforces direct role permissions and depth before surface creation", async (t) => {
	const root = await temporaryDirectory();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "grandchild.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
	for (const role of ["planner", "worker", "explorer", "reviewer"]) {
		const client = new FakeHerdrClient(path);
		const runtime = new HerdrSubagentsRuntime(fakePi(), {
			clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
			globalAgentsDir: join(root, "global"),
			env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: role, PI_HERDR_DEPTH: "1" },
		});
		const ctx = fakeContext();
		runtime.startSession(ctx);
		assert.deepEqual(runtime.getCatalog().definitions.map((item) => item.name), role === "planner" || role === "worker" ? ["explorer"] : []);
		await assert.rejects(() => runtime.launch({ agent: "worker", task: "forbidden" }, ctx), /cannot delegate/);
		assert.equal(client.calls.some(([name]) => name === "createTab"), false);
		if (role === "planner" || role === "worker") {
			await runtime.launch({ agent: "explorer", task: "inspect" }, ctx);
			assert.equal(client.calls.find(([name]) => name === "createTab")[1].env.PI_HERDR_DEPTH, "2");
			await assert.rejects(() => runtime.getResult("w1:not-owned"), /not a child owned/);
		} else {
			await assert.rejects(() => runtime.launch({ agent: "explorer", task: "inspect" }, ctx), /cannot delegate/);
		}
		runtime.shutdown();
	}
	const client = new FakeHerdrClient(path);
	const runtime = new HerdrSubagentsRuntime(fakePi(), {
		clientFactory: () => client, bundledDir: BUNDLED, policyPath: POLICY,
		globalAgentsDir: join(root, "global"),
		env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", PI_HERDR_SUBAGENT: "1", PI_HERDR_AGENT: "worker", PI_HERDR_DEPTH: "2" },
	});
	runtime.startSession(fakeContext());
	await assert.rejects(() => runtime.launch({ agent: "explorer", task: "no" }, fakeContext()), /depth limit/);
	assert.equal(client.calls.some(([name]) => name === "createTab"), false);
	runtime.shutdown();
});
