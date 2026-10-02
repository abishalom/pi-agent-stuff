import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import notifyFinished from "../../pi-extension/notify-finished/index.ts";

function setup(t, { threshold = 60, enabled = true, mode = "terminal" } = {}) {
	const overrides = {
		PI_NOTIFY_ENABLED: String(enabled),
		PI_NOTIFY_THRESHOLD_SECONDS: String(threshold),
		PI_NOTIFY_MODE: mode,
		KITTY_WINDOW_ID: undefined,
	};
	for (const [key, value] of Object.entries(overrides)) {
		const previous = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
		t.after(() => {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		});
	}
	// Ignore personal configuration and intercept terminal output: no real notifications.
	t.mock.method(fs, "existsSync", () => false);
	const output = [];
	t.mock.method(process.stdout, "write", (text) => {
		output.push(text);
		return true;
	});
	let now = 0;
	t.mock.method(Date, "now", () => now);
	const handlers = new Map();
	const commands = new Map();
	const statuses = [];
	const titles = [];
	const ctx = {
		ui: {
			theme: { fg: (_color, text) => text },
			setStatus: (key, value) => statuses.push({ key, value }),
			setTitle: (title) => titles.push(title),
		},
	};
	notifyFinished({
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: (name, definition) => commands.set(name, definition),
	});
	return {
		handlers, commands, output, statuses, titles,
		at: (time) => { now = time; },
		emit: async (event) => { await handlers.get(event)?.({ type: event }, ctx); },
	};
}

test("notify-finished stays busy at agent_end and notifies only once at settlement", async (t) => {
	const h = setup(t);
	assert.ok(h.handlers.has("agent_settled"));
	assert.ok(!h.handlers.has("agent_end"));
	assert.deepEqual([...h.commands.keys()], [
		"notify-settings", "notify-on", "notify-off", "notify-threshold", "notify-mode",
	]);
	await h.emit("session_start");
	assert.equal(h.titles.at(-1), "Pi");
	await h.emit("agent_start");
	h.at(65_000);
	await h.emit("agent_end");
	assert.deepEqual(h.output, []);
	assert.equal(h.titles.at(-1), "Pi • working");
	assert.match(h.statuses.at(-1).value, /Notify after 60s/);
	h.at(70_000);
	await h.emit("agent_settled");
	assert.deepEqual(h.output, ["\x1b]777;notify;Pi;Prompt finished in 1m 10s\x07"]);
	assert.equal(h.titles.at(-1), "Pi");
	assert.match(h.statuses.at(-1).value, /Notify terminal, 60s/);
	await h.emit("agent_settled");
	assert.equal(h.output.length, 1);
});

test("notify-finished measures the full interval across retries, recovery, and compaction", async (t) => {
	const h = setup(t);
	h.at(1_000);
	await h.emit("agent_start");
	h.at(21_000);
	await h.emit("agent_end");
	h.at(31_000);
	await h.emit("agent_start");
	h.at(41_000);
	await h.emit("agent_end");
	await h.emit("session_before_compact");
	h.at(51_000);
	await h.emit("session_compact");
	await h.emit("agent_start");
	h.at(71_000);
	await h.emit("agent_end");
	await h.emit("agent_before_settle");
	assert.deepEqual(h.output, []);
	assert.equal(h.titles.at(-1), "Pi • working");
	await h.emit("agent_settled");
	assert.deepEqual(h.output, ["\x1b]777;notify;Pi;Prompt finished in 1m 10s\x07"]);
});

test("notify-finished uses an inclusive threshold and starts fresh after settlement", async (t) => {
	const h = setup(t);
	await h.emit("agent_start");
	h.at(59_999);
	await h.emit("agent_settled");
	assert.deepEqual(h.output, []);
	h.at(100_000);
	await h.emit("agent_start");
	h.at(160_000);
	await h.emit("agent_settled");
	assert.deepEqual(h.output, ["\x1b]777;notify;Pi;Prompt finished in 1m\x07"]);
	h.at(200_000);
	await h.emit("agent_start");
	h.at(201_000);
	await h.emit("agent_settled");
	assert.equal(h.output.length, 1);
});

test("notify-finished clears unfinished timing on shutdown", async (t) => {
	const h = setup(t);
	await h.emit("agent_start");
	h.at(90_000);
	await h.emit("session_shutdown");
	assert.deepEqual(h.output, []);
	assert.equal(h.titles.at(-1), "Pi");
	await h.emit("agent_settled");
	assert.deepEqual(h.output, []);
	await h.emit("session_start");
	h.at(100_000);
	await h.emit("agent_start");
	h.at(101_000);
	await h.emit("agent_settled");
	assert.deepEqual(h.output, []);
});

for (const options of [{ enabled: false }, { mode: "off" }]) {
	test(`notify-finished respects ${JSON.stringify(options)} at settlement`, async (t) => {
		const h = setup(t, options);
		await h.emit("agent_start");
		h.at(120_000);
		await h.emit("agent_settled");
		assert.deepEqual(h.output, []);
		assert.equal(h.titles.at(-1), "Pi");
		assert.match(h.statuses.at(-1).value, /Notify disabled/);
	});
}

test("notify-finished permits an immediate notification with a zero threshold", async (t) => {
	const h = setup(t, { threshold: 0 });
	await h.emit("agent_settled");
	assert.deepEqual(h.output, []);
	await h.emit("agent_start");
	await h.emit("agent_settled");
	assert.deepEqual(h.output, ["\x1b]777;notify;Pi;Prompt finished in 0s\x07"]);
});
