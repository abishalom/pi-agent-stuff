import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };
import answerExtension from "../../pi-extension/answer/index.ts";
import { formatAnswers } from "../../pi-extension/answer/ui.ts";

function createFakePi() {
	const commands = new Map();
	const shortcuts = new Map();
	const sentMessages = [];

	return {
		commands,
		shortcuts,
		sentMessages,
		registerCommand(name, definition) {
			commands.set(name, definition);
		},
		registerShortcut(name, definition) {
			shortcuts.set(name, definition);
		},
		sendMessage(message, options) {
			sentMessages.push({ message, options });
		},
	};
}

function createRegistry() {
	const current = { provider: "openai", id: "gpt-4.1" };
	return {
		current,
		find() {
			return null;
		},
		async getApiKeyAndHeaders(model) {
			if (model === current || `${model.provider}/${model.id}` === "openai/gpt-4.1") {
				return { ok: true, apiKey: "current-key", headers: {} };
			}
			return { ok: false, error: "missing auth" };
		},
	};
}

test("package manifest loads local answer extension instead of upstream answer.ts", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/answer/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/mitsupi/extensions/answer.ts"));
});

test("package manifest references only current pi-interactive-subagents extension entrypoints", () => {
	assert.ok(packageJson.pi.extensions.includes("./node_modules/pi-interactive-subagents/pi-extension/subagents/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-interactive-subagents/pi-extension/session-artifacts/index.ts"));
});

test("extension registers one /answer command and ctrl+. shortcut", () => {
	const pi = createFakePi();
	answerExtension(pi);

	assert.equal(pi.commands.size, 1);
	assert.ok(pi.commands.has("answer"));
	assert.ok(pi.shortcuts.has("ctrl+."));
});

test("answer command submits compiled answers with upstream message prefix", async () => {
	const pi = createFakePi();
	answerExtension(pi);
	const registry = createRegistry();
	const notifications = [];
	let customCallCount = 0;

	const ctx = {
		hasUI: true,
		model: registry.current,
		modelRegistry: registry,
		sessionManager: {
			getBranch() {
				return [
					{
						type: "message",
						message: {
							role: "assistant",
							stopReason: "stop",
							content: [{ type: "text", text: "What database should we use?" }],
						},
					},
				];
			},
		},
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
			async custom() {
				customCallCount += 1;
				if (customCallCount === 1) {
					return { questions: [{ question: "What database should we use?" }] };
				}
				return "Q: What database should we use?\nA: PostgreSQL";
			},
		},
	};

	await pi.commands.get("answer").handler("", ctx);

	assert.deepEqual(notifications, []);
	assert.equal(pi.sentMessages.length, 1);
	assert.deepEqual(pi.sentMessages[0], {
		message: {
			customType: "answers",
			content: "I answered your questions in the following way:\n\nQ: What database should we use?\nA: PostgreSQL",
			display: true,
		},
		options: { triggerTurn: true },
	});
});

test("formatAnswers preserves upstream Q/A formatting", () => {
	const formatted = formatAnswers(
		[
			{ question: "Question one?", context: "Some context" },
			{ question: "Question two?" },
		],
		["Answer one", "Answer two"],
	);

	assert.equal(
		formatted,
		"Q: Question one?\n> Some context\nA: Answer one\n\nQ: Question two?\nA: Answer two",
	);
});
