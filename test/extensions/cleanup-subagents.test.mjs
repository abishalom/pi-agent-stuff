import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { CliHerdrClient, parsePaneInfo } from "../../pi-extension/herdr-subagents/herdr.ts";
import { createHerdrSubagentsExtension, HerdrSubagentsRuntime } from "../../pi-extension/herdr-subagents/index.ts";

const ROOT = join(import.meta.dirname, "../..");
const parent = { paneId: "w1:p1", tabId: "w1:t1", workspaceId: "w1", agent: "pi", status: "idle", focused: true };
const owned = (id, overrides = {}) => ({ ...parent, paneId: id, focused: false,
 tokens: { role: "explorer", pi_parent_session: "session-a", pi_parent_pane: parent.paneId, pi_cleanup_state: "ready" }, ...overrides });
const exclusions = [
 { workspaceId: "w2" }, { focused: true }, { focused: undefined },
 ...["working", "blocked", "unknown"].map(status => ({ status })),
 { tokens: { ...owned("unused").tokens, pi_parent_session: "session-b" } },
 { tokens: { ...owned("unused").tokens, pi_parent_pane: "w1:p2" } },
 { tokens: { role: "worker" } }, { tokens: {} },
 { tokens: { ...owned("unused").tokens, role: undefined } },
 { tokens: { ...owned("unused").tokens, pi_cleanup_state: "compacting" } },
 { tokens: { ...owned("unused").tokens, pi_cleanup_state: undefined } },
 { agent: undefined }, { agent: "codex" },
];

function fixture(panes = []) {
 const calls = [], notifications = [], commands = new Map(), events = new Map();
 let sessionId = "session-a";
 const ctx = { mode: "tui", cwd: ROOT, isProjectTrusted: () => false,
  sessionManager: { getSessionId: () => sessionId }, ui: { notify: (...args) => notifications.push(args) } };
 const pi = { registerCommand: (name, command) => commands.set(name, command), registerTool() {},
  registerMessageRenderer() {}, on: (name, handler) => events.set(name, handler),
  getThinkingLevel: () => "low", getAllTools: () => ["read", "bash", "write", "edit"].map(name => ({ name })),
  appendEntry() {},
  sendMessage() { assert.fail("cleanup must not send a model message"); }, sendUserMessage() { assert.fail("cleanup must not prompt a model"); } };
 const client = { async currentPane() { calls.push(["current"]); return { ...parent }; },
  async listPanes(workspace) { calls.push(["list", workspace]); return panes; },
  async getPane(id) { calls.push(["get", id]); return panes.find(p => p.paneId === id); },
  async closePane(id) { calls.push(["close", id]); } };
 const options = { clientFactory: () => client, env: { HERDR_ENV: "1", HERDR_PANE_ID: parent.paneId } };
 const runtime = new HerdrSubagentsRuntime(pi, options);
 runtime.startSession(ctx);
 return { runtime, options, pi, client, ctx, calls, commands, events, notifications, setSession: id => { sessionId = id; } };
}

function deferred() {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}

async function launchingFixture(t) {
 const f = fixture([]);
 const dir = await mkdtemp(join(tmpdir(), "cleanup-launch-"));
 t.after(() => { f.runtime.shutdown(); return rm(dir, { recursive: true, force: true }); });
 const path = join(dir, "child.jsonl");
 await writeFile(path, `${JSON.stringify({ type: "session", version: 3 })}\n`);
 f.ctx.modelRegistry = { find: (provider, id) => ({ provider, id, reasoning: true }),
  getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }) };
 const pane = owned("w1:p2", { status: "working", sessionPath: path, tokens: { pi_cleanup_state: "ready" } });
 f.client.validate = async () => {};
 f.client.createTab = async () => ({ ...pane, placement: "tab" });
 f.client.renamePane = f.client.renameTab = async () => {};
 f.client.startPi = async () => ({ ...pane, interactiveReady: true });
 f.client.reportRole = async (_id, role, owner) => {
  pane.tokens = { ...pane.tokens, role, pi_parent_session: owner.sessionId, pi_parent_pane: owner.paneId };
  f.calls.push(["ownership"]);
 };
 f.client.reportActivity = async (_id, state) => { pane.tokens.pi_cleanup_state = state; };
 f.client.prompt = async (_id, message) => { f.calls.push(["prompt", message]); return { ...pane, status: "working" }; };
 f.client.getAgent = async () => ({ ...pane });
 f.client.getPane = async () => ({ ...pane, tokens: { ...pane.tokens } });
 f.client.listPanes = async () => [{ ...pane, tokens: { ...pane.tokens } }];
 const waiting = deferred();
 let wake;
 f.client.waitAgent = (_id, _statuses, _timeout, signal) => new Promise(resolve => {
  wake = resolve;
  waiting.resolve();
  signal?.addEventListener("abort", () => resolve(null), { once: true });
 });
 return { ...f, pane, waiting: waiting.promise, wake: () => wake(null),
  launch: () => f.runtime.launch({ agent: "explorer", task: "initial task" }, f.ctx) };
}

test("Pi resource discovery no longer loads a cleanup-subagents prompt", async (t) => {
 const agentDir = await mkdtemp(join(tmpdir(), "cleanup-resource-loader-"));
 t.after(() => rm(agentDir, { recursive: true, force: true }));
 const loader = new DefaultResourceLoader({
  cwd: ROOT,
  agentDir,
  settingsManager: SettingsManager.inMemory(),
  additionalPromptTemplatePaths: [join(ROOT, "prompts")],
  noExtensions: true,
  noSkills: true,
  noThemes: true,
  noContextFiles: true,
 });
 await loader.reload();
 const loaded = loader.getPrompts();
 assert.ok(loaded.prompts.some(prompt => prompt.name === "review"), "package prompt discovery must actually run");
 assert.equal(loaded.prompts.some(prompt => prompt.name === "cleanup-subagents"), false);
});

test("cleanup is a native command with no obsolete prompt or model submission", async () => {
 assert.equal(existsSync(join(ROOT, "prompts/cleanup-subagents.md")), false);
 const f = fixture([owned("w1:p2")]);
 createHerdrSubagentsExtension(f.options)(f.pi);
 f.events.get("session_start")({}, f.ctx);
 await f.commands.get("cleanup-subagents").handler("", f.ctx);
 assert.deepEqual(f.calls.filter(c => c[0] === "close"), [["close", "w1:p2"]]);
 assert.match(f.notifications[0][0], /Closed \(1\): w1:p2\nSkipped \(0\): none\nFailed \(0\): none/);
 await f.commands.get("cleanup-subagents").handler("--force", f.ctx);
 assert.equal(f.calls.filter(c => c[0] === "close").length, 1);
 f.events.get("session_shutdown")();
});

test("cleanup limits ownership, workspace, caller, focus and lifecycle; legacy children are skipped", async () => {
 const panes = [owned("w1:p2"), owned("w1:p3", { status: "done" }), owned(parent.paneId, { focused: false }),
  ...exclusions.map((patch, i) => owned(`w1:excluded${i}`, patch))];
 const f = fixture(panes);
 const result = await f.runtime.cleanup(f.ctx);
 assert.deepEqual(result.closed, ["w1:p2", "w1:p3"]);
 assert.equal(result.skipped.length, panes.length - 2);
 assert.deepEqual(result.failed, []);
 assert.deepEqual(f.calls.find(c => c[0] === "list"), ["list", "w1"]);
 f.runtime.shutdown();
});

test("cleanup rechecks live identity, ownership, status, workspace and focus before closing", async () => {
 const changes = [null, { paneId: "w1:wrong" }, ...exclusions];
 for (const change of changes) {
  const pane = owned("w1:p2"), f = fixture([pane]);
  f.client.getPane = async () => change === null ? null : { ...pane, ...change };
  const result = await f.runtime.cleanup(f.ctx);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.closed, []);
  assert.equal(f.calls.some(c => c[0] === "close"), false);
  f.runtime.shutdown();
 }
});

test("cleanup refuses invalid mode, missing Herdr context, or stale caller context", async () => {
 for (const change of ["rpc", "outside", "caller"]) {
  const f = fixture([owned("w1:p2")]);
  if (change === "rpc") f.ctx.mode = "rpc";
  if (change === "outside") f.options.env.HERDR_ENV = "0";
  if (change === "caller") f.client.currentPane = async () => ({ ...parent, paneId: "w1:other" });
  await assert.rejects(() => f.runtime.cleanup(f.ctx), /requires|mismatch/);
  assert.equal(f.calls.some(c => c[0] === "close"), false);
  f.runtime.shutdown();
 }
});

test("cleanup reports per-pane recheck/close failures independently and continues", async () => {
 const f = fixture([owned("w1:p2"), owned("w1:p3"), owned("w1:p4"), owned("w1:p5")]);
 f.client.getPane = async id => { if (id === "w1:p2") throw new Error("read failed"); return owned(id); };
 f.client.closePane = async id => { f.calls.push(["close", id]); if (id === "w1:p3") throw new Error("close failed"); };
 const result = await f.runtime.cleanup(f.ctx);
 assert.deepEqual(result.closed, ["w1:p4", "w1:p5"]);
 assert.deepEqual(result.failed, ["w1:p2: read failed", "w1:p3: close failed"]);
 f.runtime.shutdown();
});

test("same-session reload/resume discovers children solely from Herdr metadata; tools remain runtime-only", async () => {
 const f = fixture([owned("w1:p2")]);
 f.runtime.shutdown();
 const reloaded = new HerdrSubagentsRuntime(f.pi, f.options);
 reloaded.startSession(f.ctx);
 await assert.rejects(() => reloaded.followup("w1:p2", "next"), /not a child owned/);
 assert.deepEqual((await reloaded.cleanup(f.ctx)).closed, ["w1:p2"]);
 reloaded.shutdown();
 f.setSession("different-session");
 const resumedOther = new HerdrSubagentsRuntime(f.pi, f.options);
 resumedOther.startSession(f.ctx);
 assert.deepEqual((await resumedOther.cleanup(f.ctx)).closed, []);
 resumedOther.shutdown();
});

test("session/caller changes during discovery or live recheck fail closed", async () => {
 for (const boundary of ["list", "get", "caller"]) {
  const f = fixture([owned("w1:p2"), owned("w1:p3")]);
  if (boundary === "list") f.client.listPanes = async () => { f.setSession("changed"); return [owned("w1:p2")]; };
  if (boundary === "get") f.client.getPane = async id => { f.setSession("changed"); return owned(id); };
  if (boundary === "caller") { let n = 0; f.client.currentPane = async () => ++n === 1 ? parent : { ...parent, paneId: "w1:moved" }; }
  const result = await f.runtime.cleanup(f.ctx);
  assert.deepEqual(result.closed, []);
  assert.ok(result.failed.length);
  assert.equal(f.calls.some(c => c[0] === "close"), false);
  f.runtime.shutdown();
 }
});

test("cleanup cannot close a deferred initial prompt before ownership publication/tracking", async (t) => {
 const f = await launchingFixture(t), entered = deferred(), submitted = deferred();
 f.pane.status = "idle";
 f.client.prompt = async () => { entered.resolve(); return submitted.promise; };
 const launch = f.launch();
 await entered.promise;
 assert.deepEqual((await f.runtime.cleanup(f.ctx)).closed, []);
 assert.equal(f.calls.some(c => c[0] === "ownership"), false);
 submitted.resolve({ ...f.pane, status: "working" });
 await launch;
 assert.equal(f.calls.some(c => c[0] === "ownership"), true);
 assert.deepEqual((await f.runtime.cleanup(f.ctx)).closed, [f.pane.paneId]);
});

test("failed initial submission never publishes cleanup ownership", async (t) => {
 const f = await launchingFixture(t);
 f.client.prompt = async () => { throw new Error("submission failed"); };
 await assert.rejects(() => f.launch(), /submission failed/);
 assert.equal(f.calls.some(c => c[0] === "ownership"), false);
 f.pane.status = "idle";
 assert.deepEqual((await f.runtime.cleanup(f.ctx)).closed, []);
});

test("concurrent FIFO followups are accepted while cleanup skips in-flight requests and queued work", async (t) => {
 const f = await launchingFixture(t);
 const child = await f.launch();
 await f.waiting;
 f.pane.status = "idle";
 const firstRead = deferred(), secondRead = deferred(), bothEntered = deferred();
 let count = 0;
 f.client.getAgent = () => { if (++count === 2) bothEntered.resolve(); return count === 1 ? firstRead.promise : secondRead.promise; };
 const first = f.runtime.followup(child.paneId, "first");
 const second = f.runtime.followup(child.paneId, "second");
 await bothEntered.promise;
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /operation in progress/);
 firstRead.resolve({ ...f.pane, status: "working" });
 await first;
 secondRead.resolve({ ...f.pane, status: "working" });
 await second;
 assert.deepEqual(child.queuedFollowups, ["first", "second"]);
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /queued follow-ups/);
});

test("automatic queued drain protects its shifted message through deferred submission", async (t) => {
 const f = await launchingFixture(t);
 const child = await f.launch();
 await f.waiting;
 await f.runtime.followup(child.paneId, "queued");
 f.pane.status = "idle";
 const entered = deferred(), submitted = deferred();
 f.client.prompt = async () => { entered.resolve(); return submitted.promise; };
 f.wake();
 await entered.promise;
 assert.deepEqual(child.queuedFollowups, []);
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /operation in progress/);
 submitted.resolve({ ...f.pane, status: "working" });
});

test("cleanup blocks later mutations and overlapping cleanup while its live read is deferred", async (t) => {
 const f = await launchingFixture(t);
 const child = await f.launch();
 await f.waiting;
 f.pane.status = "idle";
 const entered = deferred(), checked = deferred();
 f.client.getPane = async () => { entered.resolve(); return checked.promise; };
 const cleanup = f.runtime.cleanup(f.ctx);
 await entered.promise;
 await assert.rejects(() => f.runtime.followup(child.paneId, "too late"), /being cleaned up/);
 await assert.rejects(() => f.runtime.cleanup(f.ctx), /already running/);
 checked.resolve({ ...f.pane });
 assert.deepEqual((await cleanup).closed, [child.paneId]);
});

function childHooks(f) {
 const hooks = new Map();
 const ctx = { ...f.ctx, sessionManager: { getSessionId: () => "child-session" }, getContextUsage: () => undefined };
 const pi = { ...f.pi, on: (name, handler) => hooks.set(name, handler) };
 createHerdrSubagentsExtension({
  env: { HERDR_ENV: "1", HERDR_PANE_ID: f.pane.paneId, PI_HERDR_SUBAGENT: "1", PI_HERDR_DEPTH: "1", PI_HERDR_DELEGATES: "0" },
  clientFactory: () => ({ ...f.client, currentPane: async () => ({ ...f.pane }) }),
 })(pi);
 return { ctx, hooks };
}

test("compaction stays cleanup-ineligible after submission and parent reload until a terminal child hook", async (t) => {
 const f = await launchingFixture(t), child = await f.launch();
 await f.waiting;
 f.pane.status = "idle";
 const entered = deferred(), submitted = deferred();
 f.client.requestCompaction = async () => { entered.resolve(); await submitted.promise; };
 const { ctx, hooks } = childHooks(f);
 await hooks.get("session_start")({}, ctx);
 t.after(() => hooks.get("session_shutdown")());
 const request = f.runtime.compact(child.paneId);
 await entered.promise;
 assert.equal(f.pane.tokens.pi_cleanup_state, "compacting");
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
 submitted.resolve();
 await request;
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
 const reloaded = new HerdrSubagentsRuntime(f.pi, f.options);
 reloaded.startSession(f.ctx);
 t.after(() => reloaded.shutdown());
 assert.match((await reloaded.cleanup(f.ctx)).skipped[0], /compacting/);
 await hooks.get("session_before_compact")({ reason: "manual" }, ctx);
 await hooks.get("session_compact")({ reason: "manual", willRetry: false, fromExtension: false }, ctx);
 assert.deepEqual((await reloaded.cleanup(f.ctx)).closed, [child.paneId]);
});

test("manual compaction hooks publish live activity without a parent request and clear on failure/abort", async (t) => {
 const f = await launchingFixture(t);
 await f.launch();
 f.pane.status = "idle";
 const { ctx, hooks } = childHooks(f);
 await hooks.get("session_start")({}, ctx);
 t.after(() => hooks.get("session_shutdown")());
 for (const [reason, aborted] of [["manual", false], ["threshold", true], ["overflow", false]]) {
  await hooks.get("session_before_compact")({ reason }, ctx);
  assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
  await hooks.get("session_compact_failed")({ reason, aborted, willRetry: false, fromExtension: false }, ctx);
  assert.deepEqual((await f.runtime.cleanup(f.ctx)).closed, [f.pane.paneId]);
 }
});

test("before-compaction hook awaits live marker publication before allowing summary generation", async (t) => {
 const f = await launchingFixture(t);
 await f.launch();
 f.pane.status = "idle";
 const entered = deferred(), published = deferred();
 f.client.reportActivity = async (_id, state) => {
  if (state === "compacting") { entered.resolve(); await published.promise; }
  f.pane.tokens.pi_cleanup_state = state;
 };
 const { ctx, hooks } = childHooks(f);
 await hooks.get("session_start")({}, ctx);
 t.after(() => hooks.get("session_shutdown")());
 let allowed = false;
 const before = hooks.get("session_before_compact")({ reason: "manual" }, ctx).then(() => { allowed = true; });
 await entered.promise;
 assert.equal(allowed, false);
 published.resolve();
 await before;
 assert.equal(f.pane.tokens.pi_cleanup_state, "compacting");
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
});

test("compaction marker publication failure cancels manual compaction; ambiguous submission fails closed", async (t) => {
 const f = await launchingFixture(t);
 const child = await f.launch();
 f.pane.status = "idle";
 f.client.requestCompaction = async () => { throw new Error("ambiguous delivery"); };
 await assert.rejects(() => f.runtime.compact(child.paneId), /ambiguous delivery/);
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
 f.client.reportActivity = async () => { throw new Error("metadata unavailable"); };
 const { ctx, hooks } = childHooks(f);
 await hooks.get("session_start")({}, ctx);
 t.after(() => hooks.get("session_shutdown")());
 assert.deepEqual(await hooks.get("session_before_compact")({ reason: "manual" }, ctx), { cancel: true });
 await hooks.get("session_compact_failed")({ reason: "manual", aborted: true, willRetry: false }, ctx);
 assert.match((await f.runtime.cleanup(f.ctx)).skipped[0], /compacting/);
});

test("Herdr metadata uses actual token map schema and list/close CLI args", async () => {
 const calls = [], record = { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent: "pi", agent_status: "done", focused: false,
  tokens: { role: "explorer", pi_parent_session: "session-a", pi_parent_pane: "w1:p1", bad: 42 } };
 const client = new CliHerdrClient({ async exec(cmd, args) { calls.push([cmd, args]); return { code: 0, stderr: "", stdout: JSON.stringify({ result: args[1] === "list" ? { panes: [record] } : {} }) }; } });
 await client.reportRole("w1:p2", "explorer", { sessionId: "session-a", paneId: "w1:p1" });
 assert.deepEqual(calls[0], ["herdr", ["pane", "report-metadata", "w1:p2", "--source", "pi-herdr-subagents", "--applies-to-source", "herdr:pi",
  "--token", "role=explorer", "--token", "pi_parent_session=session-a", "--token", "pi_parent_pane=w1:p1"]]);
 const panes = await client.listPanes("w1");
 assert.equal(panes[0].focused, false);
 assert.deepEqual(panes[0].tokens, { role: "explorer", pi_parent_session: "session-a", pi_parent_pane: "w1:p1" });
 await client.closePane("w1:p2");
 await client.reportActivity("w1:p2", "compacting");
 assert.deepEqual(calls[1][1], ["pane", "list", "--workspace", "w1"]);
 assert.deepEqual(calls[2][1], ["pane", "close", "w1:p2"]);
 assert.deepEqual(calls[3][1], ["pane", "report-metadata", "w1:p2", "--source", "pi-herdr-subagents-activity", "--applies-to-source", "herdr:pi", "--token", "pi_cleanup_state=compacting"]);
 assert.deepEqual(parsePaneInfo({ ...record, tokens: undefined }).tokens, {});
});
