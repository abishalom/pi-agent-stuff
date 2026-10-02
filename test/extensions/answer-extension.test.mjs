import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };
import answerExtension from "../../pi-extension/answer/index.ts";
import { formatAnswers } from "../../pi-extension/answer/ui.ts";
import { loadAnswerConfig } from "../../pi-extension/answer/config.ts";
import { initTheme } from "@earendil-works/pi-coding-agent";

initTheme("dark", false);

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

test("package manifest loads the Herdr-native subagents extension", () => {
	assert.ok(packageJson.pi.extensions.includes("./pi-extension/herdr-subagents/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-interactive-subagents/pi-extension/subagents/index.ts"));
	assert.ok(!packageJson.pi.extensions.includes("./pi-extension/subagent-model-overrides/index.ts"));
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
		mode: "tui",
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

// Execute the real custom factories, including BorderedLoader and extraction.
// Only the provider stream is replaced: no network or credentials are used.
function extractionHarness(streamResult, { cancel = false } = {}) {
	const pi = createFakePi();
	answerExtension(pi);
	const registry = createRegistry();
	const calls = [];
	const notifications = [];
	const components = [];
	let resultCalls = 0;
	registry.streamSimple = function (model, context, options) {
		assert.equal(this, registry);
		calls.push({ model, context, options });
		return {
			result() {
				resultCalls += 1;
				return streamResult(options.signal);
			},
		};
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
		model: registry.current,
		modelRegistry: registry,
		sessionManager: {
			getBranch: () => [{
				type: "message",
				message: {
					role: "assistant", stopReason: "stop",
					content: [{ type: "text", text: "Which database?" }],
				},
			}],
		},
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			async custom(factory) {
				let done;
				const completion = new Promise((resolve) => { done = resolve; });
				const component = factory(
					{ requestRender() {} }, { fg: (_color, text) => text }, {}, done,
				);
				components.push(component);
				try {
					if (components.length === 1 && cancel) component.handleInput("\u001b");
					if (components.length === 2) done("Q: Which database?\nA: PostgreSQL");
					return await completion;
				} finally {
					component.dispose?.();
				}
			},
		},
	};
	return {
		pi, registry, calls, notifications, components,
		get resultCalls() { return resultCalls; },
		run: () => pi.commands.get("answer").handler("", ctx),
	};
}

test("extraction uses the configured registry stream and loader signal, then submits answers", async () => {
	const harness = extractionHarness(async () => ({
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "not extraction JSON" },
			{ type: "text", text: '```json\n{"questions":' },
			{ type: "text", text: '[{"question":"Which database?"}]}\n```' },
		],
	}));
	await harness.run();
	assert.equal(harness.resultCalls, 1);
	assert.equal(harness.calls.length, 1);
	const { model, context, options } = harness.calls[0];
	assert.equal(model, harness.registry.current);
	assert.match(context.systemPrompt, /You are a question extractor/);
	assert.equal(context.messages.length, 1);
	assert.equal(context.messages[0].role, "user");
	assert.deepEqual(context.messages[0].content, [{ type: "text", text: "Which database?" }]);
	assert.equal(typeof context.messages[0].timestamp, "number");
	assert.equal(options.signal, harness.components[0].signal);
	assert.equal(options.signal.aborted, false);
	const thinking = loadAnswerConfig().config.thinkingLevel;
	assert.deepEqual(options, { signal: options.signal, reasoning: thinking === "off" ? undefined : thinking });
	assert.ok(!("apiKey" in options));
	assert.ok(!("headers" in options));
	assert.deepEqual(harness.notifications, []);
	assert.equal(harness.components.length, 2);
	assert.equal(harness.pi.sentMessages.length, 1);
});

test("Escape aborts the actual loader's runtime request without submitting answers", async () => {
	let aborted = false;
	const harness = extractionHarness((signal) => new Promise((resolve) => {
		signal.addEventListener("abort", () => {
			aborted = true;
			resolve({ stopReason: "aborted", content: [] });
		}, { once: true });
	}), { cancel: true });
	await harness.run();
	assert.equal(aborted, true);
	assert.equal(harness.calls[0].options.signal.aborted, true);
	assert.equal(harness.components.length, 1);
	assert.deepEqual(harness.pi.sentMessages, []);
	assert.deepEqual(harness.notifications, [{ message: "Cancelled", level: "info" }]);
});

for (const [name, response] of [
	["aborted response", { stopReason: "aborted", content: [] }],
	["provider error response", { stopReason: "error", errorMessage: "provider failed", content: [] }],
	["invalid extraction JSON", { stopReason: "stop", content: [{ type: "text", text: "not JSON" }] }],
]) {
	test(`extraction handles ${name} without opening Q&A`, async () => {
		const harness = extractionHarness(async () => response);
		await harness.run();
		assert.equal(harness.resultCalls, 1);
		assert.equal(harness.components.length, 1);
		assert.deepEqual(harness.pi.sentMessages, []);
		assert.deepEqual(harness.notifications, [{ message: "Cancelled", level: "info" }]);
	});
}

test("extraction catches runtime rejection and reports cancellation", async (t) => {
	const errors = [];
	t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
	const harness = extractionHarness(async () => { throw new Error("runtime auth failed"); });
	await harness.run();
	assert.equal(harness.resultCalls, 1);
	assert.equal(harness.components.length, 1);
	assert.deepEqual(harness.pi.sentMessages, []);
	assert.deepEqual(harness.notifications, [{ message: "Cancelled", level: "info" }]);
	assert.match(errors[0], /extraction failed: Error: runtime auth failed/);
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
