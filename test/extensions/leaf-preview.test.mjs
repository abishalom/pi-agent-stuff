import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { readFile, rm } from "node:fs/promises";
import packageJson from "../../package.json" with { type: "json" };
import {
	createLeafPreviewExtension,
	parseDirection,
	parseSplitPaneId,
	previewCommand,
	shellQuote,
} from "../../pi-extension/leaf-preview/index.ts";

function createFakePi({ leafCode = 0 } = {}) {
	const commands = new Map();
	const execCalls = [];
	return {
		commands,
		execCalls,
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		async exec(command, args) {
			execCalls.push({ command, args });
			if (command === "leaf") return { code: leafCode, stdout: "", stderr: "" };
			if (args[0] === "pane" && args[1] === "split") {
				return { code: 0, stdout: JSON.stringify({ result: { pane: { pane_id: "w1:p2" } } }), stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
}

function context() {
	return {
		mode: "tui",
		cwd: "/tmp/project",
		sessionManager: {
			getBranch() {
				return [{
					type: "message",
					message: {
						role: "assistant",
						stopReason: "stop",
						content: [{ type: "text", text: "# Leaf\n\n$E = mc^2$" }],
					},
				}];
			},
		},
	};
}

test("package manifest loads the local Leaf preview extension", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/leaf-preview/index.ts"));
});

test("/leaf creates a focused temporary Herdr split running Leaf", async () => {
	const pi = createFakePi();
	createLeafPreviewExtension({ env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } })(pi);

	await pi.commands.get("leaf").handler("down", context());

	assert.deepEqual(pi.execCalls.slice(0, 3), [
		{ command: "leaf", args: ["--version"] },
		{
			command: "herdr",
			args: ["pane", "split", "--pane", "w1:p1", "--direction", "down", "--cwd", "/tmp/project", "--focus"],
		},
		{ command: "herdr", args: ["pane", "rename", "w1:p2", "Leaf preview"] },
	]);

	const run = pi.execCalls[3];
	assert.equal(run.command, "herdr");
	assert.deepEqual(run.args.slice(0, 3), ["pane", "run", "w1:p2"]);
	const shell = run.args[3];
	const pathMatch = shell.match(/^leaf -- '([^']+)';/);
	assert.ok(pathMatch, "Leaf command should receive a quoted Markdown path");
	assert.equal(await readFile(pathMatch[1], "utf8"), "# Leaf\n\n$E = mc^2$\n");
	assert.match(shell, /rm -rf -- '/);
	assert.match(shell, /exit "\$status"$/);
	await rm(dirname(pathMatch[1]), { recursive: true, force: true });
});

test("/leaf reports a missing Leaf installation before creating a split", async () => {
	const pi = createFakePi({ leafCode: 127 });
	createLeafPreviewExtension({ env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } })(pi);
	await assert.rejects(() => pi.commands.get("leaf").handler("", context()), /Leaf is not installed or is not on PATH/);
	assert.deepEqual(pi.execCalls, [{ command: "leaf", args: ["--version"] }]);
});

test("/leaf rejects invocation outside Herdr", async () => {
	const pi = createFakePi();
	createLeafPreviewExtension({ env: {} })(pi);
	await assert.rejects(() => pi.commands.get("leaf").handler("", context()), /requires Pi to run inside a Herdr pane/);
	assert.deepEqual(pi.execCalls, []);
});

test("Leaf helper parsing is strict and shell-safe", () => {
	assert.equal(parseDirection(""), "right");
	assert.equal(parseDirection("right"), "right");
	assert.equal(parseDirection("down"), "down");
	assert.throws(() => parseDirection("left"), /Usage/);
	assert.equal(parseSplitPaneId('{"result":{"pane":{"pane_id":"w1:p2"}}}'), "w1:p2");
	assert.throws(() => parseSplitPaneId("nope"), /malformed JSON/);
	assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
	assert.equal(previewCommand("/tmp/message.md", "/tmp/preview"), "leaf -- '/tmp/message.md'; status=$?; rm -rf -- '/tmp/preview'; exit \"$status\"");
});
