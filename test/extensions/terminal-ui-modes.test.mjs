import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import answer from "../../pi-extension/answer/index.ts";
import files from "../../pi-extension/mitsupi/files.ts";
// Match Pi's loader for legacy TUI classes with TS parameter properties.
const { createJiti } = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"))("jiti");
const todos = await createJiti(import.meta.url).import("../../pi-extension/mitsupi/todos.ts", { default: true });
import changedFiles from "../../pi-extension/session-changed-files/index.ts";
const stash = await createJiti(import.meta.url).import("../../pi-extension/prompt-stash/index.ts", { default: true });

initTheme("dark", false);
function harness(extension, mode = "rpc") {
 const cwd = mkdtempSync(join(tmpdir(), "terminal-modes-"));
 const commands = new Map(), shortcuts = new Map(), tools = new Map(), events = new Map();
 const mutations = [], notifications = [], statuses = [];
 let customCalls = 0, editorReads = 0, editorText = "draft";
 const forbidden = () => assert.fail("Rejected command accessed runtime/session/filesystem work");
 const pi = {
  registerCommand: (name, def) => commands.set(name, def),
  registerShortcut: (name, def) => shortcuts.set(name, def),
  registerTool: (def) => tools.set(def.name, def),
  on: (name, handler) => events.set(name, handler),
  appendEntry: (...args) => mutations.push(args), sendMessage: forbidden, exec: forbidden,
 };
 const ctx = { cwd, mode, hasUI: true,
  model: { provider: "openai", id: "current" },
  modelRegistry: { find: forbidden, streamSimple: forbidden, getApiKeyAndHeaders: forbidden },
  sessionManager: { getBranch: forbidden, getSessionId: () => "test-session", getSessionFile: () => undefined },
  ui: {
   theme: { fg: (_color, text) => text, bold: text => text }, 
   notify: (message, level) => notifications.push({ message, level }),
   setStatus: (_key, value) => statuses.push(value), setWidget() {},
   custom: async () => { customCalls++; return undefined; },
   getEditorText: () => { editorReads++; return ctx.mode === "rpc" ? "" : editorText; },
   setEditorText: (text) => { editorText = text; },
  },
 };
 extension(pi);
 return { pi, ctx, commands, shortcuts, tools, events, mutations, notifications, statuses,
  get customCalls() { return customCalls; }, get editorReads() { return editorReads; },
  get editorText() { return editorText; }, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

for (const [extension, command, shortcut] of [
 [answer, "answer", "ctrl+."], [files, "files", "ctrl+shift+o"],
 [todos, "todos"], [changedFiles, "changed-files"],
]) {
 test(`${command} rejects RPC with hasUI true before rendering or extraction`, async () => {
  const h = harness(extension);
  try {
   await h.commands.get(command).handler("", h.ctx);
   if (shortcut) await h.shortcuts.get(shortcut).handler(h.ctx);
   assert.equal(h.customCalls, 0);
   assert.deepEqual(h.mutations, []);
   assert.equal(h.editorReads, 0);
   assert.ok(h.notifications.every(n => n.level === "error" && /interactive mode/.test(n.message)));
   assert.equal(h.notifications.length, shortcut ? 2 : 1);
  } finally { h.cleanup(); }
 });
}

test("stash RPC commands/shortcuts preserve saved items and unknown editor draft", async () => {
 const h = harness(stash);
 const item = { id: "saved", text: "saved prompt", createdAt: 1 };
 h.ctx.sessionManager.getBranch = () => [{ type: "custom", customType: "prompt-stash", data: { op: "push", item } }];
 try {
  await h.events.get("session_start")({}, h.ctx);
  for (const command of ["stash", "stash-pop", "stash-pick"]) await h.commands.get(command).handler("", h.ctx);
  for (const shortcut of h.shortcuts.values()) await shortcut.handler(h.ctx);
  assert.equal(h.customCalls, 0);
  assert.equal(h.editorReads, 0);
  assert.equal(h.editorText, "draft");
  assert.deepEqual(h.mutations, []);
  // Same in-memory saved item remains available when the context has a real editor.
  h.ctx.mode = "tui";
  await h.commands.get("stash-pop").handler("", h.ctx);
  assert.match(h.editorText, /saved prompt/);
  assert.deepEqual(h.mutations, [["prompt-stash", { op: "remove", id: "saved" }]]);
 } finally { h.cleanup(); }
});

test("stash-clear remains usable in RPC", async () => {
 const h = harness(stash);
 h.ctx.sessionManager.getBranch = () => [{ type: "custom", customType: "prompt-stash", data: { op: "push", item: { id: "s", text: "saved", createdAt: 1 } } }];
 try {
  await h.events.get("session_start")({}, h.ctx);
  await h.commands.get("stash-clear").handler("", h.ctx);
  assert.deepEqual(h.mutations, [["prompt-stash", { op: "clear" }]]);
 } finally { h.cleanup(); }
});

test("todo tool remains functional in RPC and supports stale-lock confirmation", async () => {
 const h = harness(todos);
 try {
  const tool = h.tools.get("todo");
  const execute = params => tool.execute("call", params, undefined, undefined, h.ctx);
  const created = await execute({ action: "create", title: "RPC task", body: "keep" });
  const id = created.details.todo.id;
  const todoPath = join(h.ctx.cwd, ".pi", "todos", `${id}.md`);
  const before = readFileSync(todoPath, "utf8");
  await h.commands.get("todos").handler("", h.ctx);
  assert.equal(readFileSync(todoPath, "utf8"), before);
  const listed = await execute({ action: "list" });
  assert.equal(listed.details.todos.length, 1);
  const lockPath = join(h.ctx.cwd, ".pi", "todos", `${id}.lock`);
  writeFileSync(lockPath, JSON.stringify({ session: "old-session" }));
  utimesSync(lockPath, new Date(0), new Date(0));
  let confirmations = 0;
  h.ctx.ui.confirm = async () => { confirmations++; return true; };
  const claimed = await execute({ action: "claim", id });
  assert.equal(confirmations, 1);
  assert.equal(claimed.details.todo.assigned_to_session, "test-session");
  assert.equal(h.customCalls, 0);
 } finally { h.cleanup(); }
});

test("changed-files-reset remains usable in RPC", async () => {
 const h = harness(changedFiles);
 try {
  await h.commands.get("changed-files-reset").handler("", h.ctx);
  assert.equal(h.mutations.length, 1);
  assert.equal(h.customCalls, 0);
 } finally { h.cleanup(); }
});

test("files still opens and cancels its selector in TUI", async () => {
 const h = harness(files, "tui");
 writeFileSync(join(h.ctx.cwd, "file.txt"), "hello");
 h.ctx.sessionManager.getBranch = () => [{ type: "message", message: {
  role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "file.txt" } }],
 } }];
 h.pi.exec = async () => ({ code: 1, stdout: "", stderr: "not a git repo" });
 let rendered = false;
 h.ctx.ui.custom = async factory => {
  const component = factory({ requestRender() {} }, h.ctx.ui.theme,
   { matches: (_key, action) => action === "tui.select.cancel" }, () => {});
  rendered = true;
  assert.equal(typeof component.render, "function");
  component.handleInput("\u001b");
  return null;
 };
 try {
  await h.commands.get("files").handler("", h.ctx);
  assert.equal(rendered, true);
  assert.ok(h.notifications.some(n => n.message === "Files cancelled"));
 } finally { h.cleanup(); }
});

for (const [extension, command] of [[todos, "todos"], [changedFiles, "changed-files"]]) {
 test(`${command} still opens a custom component in TUI`, async () => {
  const h = harness(extension, "tui");
  h.ctx.sessionManager.getBranch = () => [];
  h.ctx.ui.custom = async factory => {
   const component = factory({ requestRender() {} }, h.ctx.ui.theme, { matches: (_key, action) => action === "tui.select.cancel" }, () => {});
   assert.equal(typeof component.render, "function");
   component.handleInput?.("\u001b");
   component.dispose?.();
  };
  try { await h.commands.get(command).handler("", h.ctx); }
  finally { h.cleanup(); }
 });
}
