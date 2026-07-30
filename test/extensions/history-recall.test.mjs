import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import historyRecall, { bounded, chunkText, extractDocuments, historicalContext, HistoryIndex } from "../../pi-extension/history-recall/index.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const header = { type: "session", version: 3, id: "session-a", timestamp: "2025-01-01T00:00:00.000Z", cwd: "/fixture" };
const line = (value) => JSON.stringify(value);
function fixture(entries) { return [line(header), ...entries.map(line)].join("\n") + "\n"; }

test("extractDocuments indexes only the four agreed source kinds and stable chunks", () => {
 const raw = fixture([
  { type: "session_info", id: "name", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", name: "Useful chat" },
  { type: "message", id: "u", parentId: "name", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "find auth bug" } },
  { type: "message", id: "a", parentId: "u", timestamp: "2025-01-01T00:00:03.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "fixed auth" }, { type: "toolCall", name: "bash", arguments: {} }] } },
  { type: "message", id: "tool", parentId: "a", timestamp: "2025-01-01T00:00:04.000Z", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "do not index" }] } },
  { type: "compaction", id: "c", parentId: "tool", timestamp: "2025-01-01T00:00:05.000Z", summary: "compacted auth", firstKeptEntryId: "u", tokensBefore: 3 },
  { type: "branch_summary", id: "b", parentId: "a", timestamp: "2025-01-01T00:00:06.000Z", fromId: "tool", summary: "branch auth" },
 ]);
 const docs = extractDocuments("/fixture/a.jsonl", raw);
 assert.deepEqual(docs.map((doc) => doc.role), ["user", "assistant", "compaction", "branch_summary"]);
 assert.equal(docs[1].sessionName, "Useful chat");
 assert.equal(docs[1].id, "session-a:3:0");
 assert.equal(docs.some((doc) => doc.text.includes("secret") || doc.text.includes("do not index")), false);
});

test("historical context includes a deterministic same-branch descendant window and optional tool results", async () => {
 const text = "x".repeat(2100);
 const chunks = chunkText(text, 1000, 100);
 assert.equal(chunks.length, 3);
 assert.equal(chunks[0].slice(-100), chunks[1].slice(0, 100));
 const directory = mkdtempSync(join(tmpdir(), "history-recall-fixture-"));
 const path = join(directory, "chat.jsonl");
 writeFileSync(path, fixture([
  { type: "message", id: "u", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "question" } },
  { type: "message", id: "a", parentId: "u", timestamp: "2025-01-01T00:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
  { type: "message", id: "t", parentId: "a", timestamp: "2025-01-01T00:00:04.000Z", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "tool evidence" }] } },
  { type: "message", id: "leaf", parentId: "t", timestamp: "2025-01-01T00:00:05.000Z", message: { role: "user", content: "follow up" } },
  { type: "message", id: "alternate", parentId: "u", timestamp: "2025-01-01T00:00:06.000Z", message: { role: "assistant", content: [{ type: "text", text: "alternate answer" }] } },
 ]));
 const documents = extractDocuments(path, await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8")));
 const document = documents.find((doc) => doc.entryId === "leaf");
 const userDocument = documents.find((doc) => doc.entryId === "u");
 assert.ok(document); assert.ok(userDocument);
 assert.doesNotMatch(await historicalContext(document, false), /tool evidence/);
 assert.match(await historicalContext(document, true), /tool evidence/);
 assert.match(await historicalContext(userDocument, false), /\[assistant a\] answer/);
 assert.doesNotMatch(await historicalContext(userDocument, false), /alternate answer/);
 assert.match(bounded("z".repeat(1000), 100), /truncated/);
});

test("historical context follows tool loops until three visible descendants", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-tool-loop-"));
 const path = join(directory, "chat.jsonl");
 const raw = fixture([
  { type: "message", id: "u", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "investigate tool loop" } },
  { type: "message", id: "calls", parentId: "u", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }, { type: "toolCall", name: "read", arguments: {} }] } },
  { type: "message", id: "result-a", parentId: "calls", timestamp: "2025-01-01T00:00:03.000Z", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "first evidence" }] } },
  { type: "message", id: "result-b", parentId: "result-a", timestamp: "2025-01-01T00:00:04.000Z", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "second evidence" }] } },
  { type: "message", id: "answer", parentId: "result-b", timestamp: "2025-01-01T00:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "final answer after tools" }] } },
 ]);
 writeFileSync(path, raw);
 const user = extractDocuments(path, raw).find((doc) => doc.entryId === "u");
 assert.ok(user);
 const withoutResults = await historicalContext(user, false);
 assert.match(withoutResults, /final answer after tools/);
 assert.doesNotMatch(withoutResults, /first evidence|second evidence/);
 const withResults = await historicalContext(user, true);
 assert.match(withResults, /first evidence/);
 assert.match(withResults, /second evidence/);
 assert.match(withResults, /final answer after tools/);
});

test("historical context retains the terminal answer beyond four tool results for both render modes", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-long-tools-"));
 const path = join(directory, "chat.jsonl");
 const entries = [{ type: "message", id: "u", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "investigate" } }, { type: "message", id: "calls", parentId: "u", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] } }];
 let parentId = "calls";
 for (let i = 1; i <= 5; i++) { entries.push({ type: "message", id: `tool-${i}`, parentId, timestamp: `2025-01-01T00:00:0${i + 2}.000Z`, message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: `evidence ${i}` }] } }); parentId = `tool-${i}`; }
 entries.push({ type: "message", id: "final", parentId, timestamp: "2025-01-01T00:00:09.000Z", message: { role: "assistant", content: [{ type: "text", text: "terminal answer" }] } });
 const raw = fixture(entries); writeFileSync(path, raw);
 const document = extractDocuments(path, raw).find((doc) => doc.entryId === "u"); assert.ok(document);
 const withoutResults = await historicalContext(document, false);
 assert.match(withoutResults, /terminal answer/); assert.doesNotMatch(withoutResults, /evidence/);
 const withResults = await historicalContext(document, true);
 assert.match(withResults, /terminal answer/); assert.match(withResults, /evidence 1/); assert.doesNotMatch(withResults, /evidence 5/);
});

test("historical context honors an aborted read signal", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-cancel-"));
 const path = join(directory, "chat.jsonl");
 const raw = fixture([{ type: "message", id: "u", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "cancel me" } }]);
 writeFileSync(path, raw);
 const controller = new AbortController();
 controller.abort();
 await assert.rejects(historicalContext(extractDocuments(path, raw)[0], false, controller.signal), /cancelled/);
});

test("legacy v1 sessions use stable source ordinals without rewriting the source", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-v1-"));
 const path = join(directory, "legacy.jsonl");
 const raw = [
  line({ type: "session", version: 1, id: "legacy-session", timestamp: "2025-01-01T00:00:00.000Z", cwd: "/fixture" }),
  line({ type: "message", timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "legacy question" } }),
  line({ type: "message", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "legacy answer" }] } }),
 ].join("\n") + "\n";
 writeFileSync(path, raw);
 const first = extractDocuments(path, raw), second = extractDocuments(path, raw);
 assert.deepEqual(first.map((doc) => doc.id), second.map((doc) => doc.id));
 assert.equal(new Set(first.map((doc) => doc.id)).size, 2);
 assert.match(await historicalContext(first[0], false), /legacy answer/);
 assert.equal(await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8")), raw);
});

test("refresh discovers only current-folder sessions, excludes active sessions, and refreshes changed/deleted files", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-cache-"));
 const active = join(directory, "active.jsonl"), other = join(directory, "other.jsonl"), foreign = join(directory, "foreign.jsonl");
 writeFileSync(active, fixture([{ type: "message", id: "active", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "active-only" } }]));
 writeFileSync(other, fixture([{ type: "message", id: "other", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "old-word" } }]));
 writeFileSync(foreign, fixture([{ type: "message", id: "foreign", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "foreign-only" } }]).replace('"cwd":"/fixture"', '"cwd":"/elsewhere"'));
 const index = new HistoryIndex();
 await index.refresh({ cwd: "/fixture", sessionDir: directory, activeFile: active });
 assert.equal(index.search("active-only").length, 0);
 assert.equal(index.search("foreign-only").length, 0);
 assert.equal(index.search("old-word").length, 1);
 writeFileSync(other, fixture([{ type: "message", id: "other", parentId: null, timestamp: "2025-01-01T00:00:03.000Z", message: { role: "user", content: "fresh-word" } }]));
 await index.refresh({ cwd: "/fixture", sessionDir: directory, activeFile: active, force: true });
 assert.equal(index.search("old-word").length, 0);
 assert.equal(index.search("fresh-word").length, 1);
 await import("node:fs/promises").then(({ unlink }) => unlink(other));
 await index.refresh({ cwd: "/fixture", sessionDir: directory, activeFile: active, force: true });
 assert.equal(index.search("fresh-word").length, 0);
});

test("warm refreshes honor the TTL, skip no-op cache writes, and avoid duplicated MiniSearch documents", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-ttl-"));
 const path = join(directory, "other.jsonl");
 writeFileSync(path, fixture([{ type: "message", id: "m", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "ttl-word" } }]));
 let discoveries = 0;
 const discoverFiles = async () => { discoveries++; const info = await stat(path); return [{ path, mtimeMs: info.mtimeMs, size: info.size }]; };
 const cwd = "/ttl", key = createHash("sha256").update(`${cwd}\0${directory}`).digest("hex");
 const indexPath = join(getAgentDir(), "cache", "history-recall", `${key}.index.json`);
 const index = new HistoryIndex({ discoverFiles, refreshTtlMs: 60_000 });
 await index.refresh({ cwd, sessionDir: directory });
 const serialized = JSON.parse(await readFile(indexPath, "utf8"));
 assert.deepEqual(serialized.storedFields, {});
 const before = (await stat(indexPath)).mtimeMs;
 await index.refresh({ cwd, sessionDir: directory });
 assert.equal(discoveries, 1);
 await new Promise((resolve) => setTimeout(resolve, 20));
 await index.refresh({ cwd, sessionDir: directory, force: true });
 assert.equal(discoveries, 2);
 assert.equal((await stat(indexPath)).mtimeMs, before);
 const restored = new HistoryIndex({ discoverFiles });
 await restored.refresh({ cwd, sessionDir: directory });
 assert.equal(restored.search("ttl-word").length, 1);
 assert.equal((await stat(indexPath)).mtimeMs, before);
});

test("concurrent forced refreshes are serialized and publish cache state without temp-file collisions", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-concurrent-"));
 const path = join(directory, "other.jsonl");
 writeFileSync(path, fixture([{ type: "message", id: "m", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "parallel-word" } }]));
 let inFlight = 0, maximum = 0, calls = 0;
 const discoverFiles = async () => {
  calls++; maximum = Math.max(maximum, ++inFlight);
  await new Promise((resolve) => setTimeout(resolve, 15));
  inFlight--;
  const info = await stat(path);
  return [{ path, mtimeMs: info.mtimeMs, size: info.size }];
 };
 const index = new HistoryIndex({ discoverFiles });
 await Promise.all([index.refresh({ cwd: "/concurrent", sessionDir: directory, force: true }), index.refresh({ cwd: "/concurrent", sessionDir: directory, force: true })]);
 assert.equal(maximum, 1); assert.equal(calls, 2);
 assert.equal(index.search("parallel-word").length, 1);
});

test("aborted queued refresh never runs or publishes after the active serialized refresh", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-abort-refresh-"));
 const path = join(directory, "other.jsonl");
 writeFileSync(path, fixture([{ type: "message", id: "m", parentId: null, timestamp: "2025-01-01T00:00:02.000Z", message: { role: "user", content: "published-word" } }]));
 let calls = 0, release;
 const discoverFiles = async () => { calls++; await new Promise((resolve) => { release = resolve; }); const info = await stat(path); return [{ path, mtimeMs: info.mtimeMs, size: info.size }]; };
 const index = new HistoryIndex({ discoverFiles });
 const first = index.refresh({ cwd: "/abort-serialized", sessionDir: directory });
 while (!release) await new Promise((resolve) => setImmediate(resolve));
 const controller = new AbortController();
 const second = index.refresh({ cwd: "/abort-serialized", sessionDir: directory, signal: controller.signal, force: true });
 controller.abort(); await assert.rejects(second, /cancelled/);
 release(); await first;
 await new Promise((resolve) => setImmediate(resolve));
 assert.equal(calls, 1); assert.equal(index.search("published-word").length, 1);
});

test("cyclic parent data returns malformed context instead of looping", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-cycle-"));
 const path = join(directory, "cycle.jsonl");
 const raw = fixture([
  { type: "message", id: "a", parentId: "b", timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "cycle query" } },
  { type: "message", id: "b", parentId: "a", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "cycle answer" }] } },
 ]);
 writeFileSync(path, raw);
 const document = extractDocuments(path, raw)[0];
 assert.equal(await historicalContext(document, false), null);
});

function fakePi() {
 const commands = new Map(), tools = new Map(), handlers = new Map(), sent = [], active = ["read"], setCalls = [];
 return { commands, tools, handlers, sent, setCalls, getActiveTools: () => active, setActiveTools: (next) => { setCalls.push([...next]); active.splice(0, active.length, ...next); }, registerTool: (tool) => { tools.set(tool.name, tool); active.push(tool.name); }, registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => handlers.set(name, handler), sendUserMessage: (text) => sent.push(text) };
}
test("a recall search refreshes once and citation reads use that snapshot", async () => {
 const directory = mkdtempSync(join(tmpdir(), "history-recall-one-refresh-"));
 const path = join(directory, "chat.jsonl"), raw = fixture([
  { type: "message", id: "u", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: "snapshot question" } },
  { type: "message", id: "a", parentId: "u", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "snapshot answer" }] } },
 ]);
 writeFileSync(path, raw);
 const document = extractDocuments(path, raw)[0];
 const originalRefresh = HistoryIndex.prototype.refresh, originalSearch = HistoryIndex.prototype.search, originalGet = HistoryIndex.prototype.get;
 let refreshes = 0;
 HistoryIndex.prototype.refresh = async () => { refreshes++; };
 HistoryIndex.prototype.search = () => [document];
 HistoryIndex.prototype.get = () => document;
 try {
  const pi = fakePi(); historyRecall(pi);
  const commandCtx = { isIdle: () => true, ui: { notify() {} } };
  await pi.commands.get("recall").handler("snapshot?", commandCtx);
  await pi.handlers.get("before_agent_start")({ prompt: pi.sent[0] }, commandCtx);
  await pi.handlers.get("agent_start")({}, commandCtx);
  const toolCtx = { sessionManager: { getCwd: () => "/fixture", getSessionDir: () => directory, getSessionFile: () => undefined } };
  await pi.tools.get("history_search").execute("search", { query: "snapshot" }, undefined, undefined, toolCtx);
  const result = await pi.tools.get("history_read").execute("read", { resultId: document.id }, undefined, undefined, toolCtx);
  assert.equal(refreshes, 1); assert.match(result.content[0].text, /snapshot answer/);
  await pi.handlers.get("agent_settled")({}, commandCtx);
 } finally {
  HistoryIndex.prototype.refresh = originalRefresh; HistoryIndex.prototype.search = originalSearch; HistoryIndex.prototype.get = originalGet;
 }
});

test("/recall avoids runtime actions while loading, activates only for its acknowledged turn, and deactivates when settled", async () => {
 const pi = fakePi(); historyRecall(pi);
 assert.equal(pi.setCalls.length, 0);
 const notices = [];
 const ctx = { isIdle: () => true, ui: { notify: (...args) => notices.push(args) } };
 await pi.handlers.get("session_start")({}, ctx);
 assert.deepEqual(pi.getActiveTools(), ["read"]);
 await pi.commands.get("recall").handler("", ctx);
 assert.match(notices[0][0], /Usage/);
 await pi.commands.get("recall").handler("where is auth?", ctx);
 assert.deepEqual(pi.getActiveTools().sort(), ["history_read", "history_search", "read"]);
 assert.match(pi.sent[0], /where is auth/);
 await pi.handlers.get("before_agent_start")({ prompt: pi.sent[0] }, ctx);
 await pi.handlers.get("agent_start")({}, ctx);
 await pi.handlers.get("agent_settled")({}, ctx);
 assert.deepEqual(pi.getActiveTools(), ["read"]);
});

test("/recall rejects overlapping launches and stale watchdog callbacks", async () => {
 const pi = fakePi(); historyRecall(pi);
 const notices = [], timers = [];
 const ctx = { isIdle: () => true, ui: { notify: (...args) => notices.push(args) } };
 const originalSetTimeout = globalThis.setTimeout;
 globalThis.setTimeout = (callback) => { timers.push(callback); return timers.length; };
 try {
  await pi.commands.get("recall").handler("first", ctx);
  await pi.commands.get("recall").handler("second", ctx);
  assert.equal(pi.sent.length, 1); assert.match(notices[0][0], /already/);
  // End the first generation, then launch another. A manually-fired cleared timer is stale.
  await pi.handlers.get("session_start")({}, ctx);
  await pi.commands.get("recall").handler("third", ctx);
  timers[0]();
  assert.deepEqual(pi.getActiveTools().sort(), ["history_read", "history_search", "read"]);
 } finally { globalThis.setTimeout = originalSetTimeout; }
});

test("/recall launch watchdog and unrelated prompts prevent leaked tools after fire-and-forget failure", async () => {
 const pi = fakePi(); historyRecall(pi);
 const ctx = { isIdle: () => true, ui: { notify() {} } };
 const originalSetTimeout = globalThis.setTimeout;
 let watchdog;
 globalThis.setTimeout = (callback) => { watchdog = callback; return { unref() {} }; };
 try {
  // Pi's real sendUserMessage catches async preflight rejection, so it returns normally here.
  await pi.commands.get("recall").handler("preflight fails", ctx);
  assert.deepEqual(pi.getActiveTools().sort(), ["history_read", "history_search", "read"]);
  watchdog();
  assert.deepEqual(pi.getActiveTools(), ["read"]);
  await pi.commands.get("recall").handler("try again", ctx);
  await pi.handlers.get("before_agent_start")({ prompt: "ordinary later prompt" }, ctx);
  assert.deepEqual(pi.getActiveTools(), ["read"]);
 } finally { globalThis.setTimeout = originalSetTimeout; }
});
