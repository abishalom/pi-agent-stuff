import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "../../pi-extension/session-changed-files/index.ts";

function harness(manager, cwd) {
 const handlers = new Map(), commands = new Map();
 let status;
 const pi = {
  on: (name, handler) => handlers.set(name, handler),
  registerCommand: (name, command) => commands.set(name, command),
  appendEntry: (type, data) => manager.appendCustomEntry(type, data),
 };
 const ctx = { cwd, hasUI: true, mode: "tui", sessionManager: manager, ui: {
  theme: { fg: (_color, text) => text }, setStatus: (_key, value) => { status = value; },
  setWidget() {}, notify() {},
 }};
 extension(pi);
 return { ctx, commands, status: () => status, emit: (name, event = {}) => handlers.get(name)(event, ctx) };
}
const edit = (id, parentToolCallId) => ({ toolName: "edit", toolCallId: id, parentToolCallId,
 input: { path: "edited.txt" }, details: { diff: "@@ -1 +1 @@\n-old\n+new", retained: true }, isError: false });
const write = (id, parentToolCallId) => ({ toolName: "write", toolCallId: id, parentToolCallId,
 input: { path: "written.txt", content: "new\nextra\n" }, isError: false });

// Actual JSONL storage, not fabricated nested result transcript entries.
test("nested edit/write survive disk reload, parent cancellation, and mixed direct results without duplication", async () => {
 const cwd = mkdtempSync(join(tmpdir(), "changed-persistence-"));
 try {
  writeFileSync(join(cwd, "written.txt"), "old\n");
  const manager = SessionManager.create(cwd, join(cwd, "sessions"));
  manager.appendMessage({ role: "user", content: "go", timestamp: Date.now() });
  const h = harness(manager, cwd);
  await h.emit("session_start");
  const nestedEdit = await h.emit("tool_result", edit("parent/1", "parent"));
  assert.equal(nestedEdit.details.retained, true);
  await h.emit("tool_call", write("parent/2", "parent"));
  await h.emit("tool_result", write("parent/2", "parent"));
  const direct = await h.emit("tool_result", edit("direct"));
  manager.appendMessage({ role: "toolResult", toolName: "edit", toolCallId: "direct", content: [], ...direct, isError: false, timestamp: Date.now() });
  await h.emit("tool_call", write("direct-write"));
  const directWrite = await h.emit("tool_result", write("direct-write"));
  manager.appendMessage({ role: "toolResult", toolName: "write", toolCallId: "direct-write", content: [], ...directWrite, isError: false, timestamp: Date.now() });
  manager.appendMessage({ role: "toolResult", toolName: "codemode", toolCallId: "parent", content: [], isError: true, timestamp: Date.now(), nestedCalls: { complete: false, calls: [] } });
  assert.equal(h.status(), "Changed: 2 +6 -4");
  assert.equal(manager.getBranch().filter(e => e.customType === "session-changed-files-nested-operation").length, 2);
  const restored = harness(SessionManager.open(manager.getSessionFile()), cwd);
  await restored.emit("session_start");
  assert.equal(restored.status(), h.status());
  await restored.emit("session_tree");
  assert.equal(restored.status(), h.status());
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("tree paths and reset markers replay independently; writes finishing after reset count", async () => {
 const cwd = mkdtempSync(join(tmpdir(), "changed-tree-"));
 try {
  const manager = SessionManager.inMemory(cwd);
  const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
  const h = harness(manager, cwd);
  await h.emit("tool_result", edit("a/1", "a"));
  const branchA = manager.getLeafId();
  await h.emit("tool_call", write("a/2", "a"));
  await h.commands.get("changed-files-reset").handler("", h.ctx);
  const reset = manager.getLeafId();
  await h.emit("tool_result", write("a/2", "a"));
  const afterReset = manager.getLeafId();
  assert.equal(h.status(), "Changed: 1 +2 -0");
  manager.branch(branchA); await h.emit("session_tree");
  assert.equal(h.status(), "Changed: 1 +1 -1");
  manager.branch(reset); await h.emit("session_tree");
  assert.equal(h.status(), "Changed: none");
  manager.branch(root); await h.emit("session_tree");
  await h.emit("tool_result", edit("b/1/1", "b/1"));
  assert.equal(h.status(), "Changed: 1 +1 -1");
  manager.branch(afterReset); await h.emit("session_tree");
  assert.equal(h.status(), "Changed: 1 +2 -0");
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("failed/cancelled nested calls and abandoned write snapshots never persist", async () => {
 const manager = SessionManager.inMemory();
 const cwd = mkdtempSync(join(tmpdir(), "changed-failure-"));
 try {
  const h = harness(manager, cwd);
  await h.emit("session_start");
  await h.emit("tool_result", { ...edit("p/1", "p"), isError: true });
  await h.emit("tool_call", write("p/2", "p"));
  await h.emit("tool_result", { ...write("p/2", "p"), isError: true });
  await h.emit("tool_result", write("p/2", "p"));
  await h.emit("tool_call", write("p/3", "p"));
  await h.emit("agent_end");
  await h.emit("tool_result", write("p/3", "p"));
  assert.equal(h.status(), "Changed: none");
  assert.equal(manager.getBranch().length, 0);
 } finally { rmSync(cwd, { recursive: true, force: true }); }
});
