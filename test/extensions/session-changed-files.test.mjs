import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sessionChangedFiles from "../../pi-extension/session-changed-files/index.ts";

function createFakePi() {
	const handlers = new Map();
	const commands = new Map();
	const entries = [];

	return {
		handlers,
		commands,
		entries,
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		appendEntry(type, data) {
			entries.push({ type, data });
		},
	};
}

function createTheme() {
	return {
		fg(_color, text) {
			return text;
		},
	};
}

function createContext(cwd) {
	const statusCalls = [];
	const widgetCalls = [];
	const notifications = [];
	const theme = createTheme();
	const ctx = {
		cwd,
		hasUI: true,
		sessionManager: {
			getBranch() {
				return [];
			},
		},
		ui: {
			theme,
			setStatus(key, value) {
				statusCalls.push({ key, value });
			},
			setWidget(key, value) {
				widgetCalls.push({ key, value });
			},
			notify(message, level) {
				notifications.push({ message, level });
			},
			async custom(_factory) {},
		},
	};

	return { ctx, statusCalls, widgetCalls, notifications };
}

test("session-changed-files registers only current session lifecycle hooks", () => {
	const pi = createFakePi();
	sessionChangedFiles(pi);

	assert.ok(pi.handlers.has("session_start"));
	assert.ok(pi.handlers.has("session_tree"));
	assert.ok(!pi.handlers.has("session_switch"));
	assert.ok(!pi.handlers.has("session_fork"));
});

test("session-changed-files ignores failed write tool results", async () => {
	const pi = createFakePi();
	sessionChangedFiles(pi);

	const cwd = mkdtempSync(join(tmpdir(), "session-changed-files-"));
	const { ctx, statusCalls } = createContext(cwd);

	await pi.handlers.get("session_start")[0]({}, ctx);
	const statusCallCountAfterStart = statusCalls.length;

	await pi.handlers.get("tool_call")[0](
		{
			toolName: "write",
			toolCallId: "call-1",
			input: { path: "notes.txt" },
		},
		ctx,
	);

	const result = await pi.handlers.get("tool_result")[0](
		{
			toolName: "write",
			toolCallId: "call-1",
			input: { content: "new text" },
			details: { existing: true },
			isError: true,
		},
		ctx,
	);

	assert.equal(result, undefined);
	assert.equal(statusCalls.length, statusCallCountAfterStart);
});
