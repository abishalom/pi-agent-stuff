import test from "node:test";
import assert from "node:assert/strict";
import { selectExtractionModel } from "../../pi-extension/answer/model-selection.ts";
import { DEFAULT_ANSWER_CONFIG } from "../../pi-extension/answer/config.ts";

function createRegistry({ available = {}, auth = {} } = {}) {
	return {
		find(provider, model) {
			return available[`${provider}/${model}`] ?? null;
		},
		async getApiKeyAndHeaders(model) {
			return auth[`${model.provider}/${model.id}`] ?? { ok: false, error: "missing auth" };
		},
	};
}

const codex = { provider: "openai-codex", id: "gpt-6-luna" };
const current = { provider: "openai", id: "gpt-4.1" };
const authenticated = { ok: true, apiKey: "test-key", headers: {} };

test("selectExtractionModel prefers Codex Luna over the current model", async () => {
	const registry = createRegistry({
		available: { "openai-codex/gpt-6-luna": codex },
		auth: {
			"openai-codex/gpt-6-luna": authenticated,
			"openai/gpt-4.1": authenticated,
		},
	});
	assert.equal(await selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG), codex);
});

test("selectExtractionModel respects explicit priority order overrides", async () => {
	const registry = createRegistry({
		available: {
			"openai-codex/gpt-6-luna": codex,
			"openai/gpt-4.1": current,
		},
		auth: {
			"openai-codex/gpt-6-luna": authenticated,
			"openai/gpt-4.1": authenticated,
		},
	});
	for (const refs of [
		[{ provider: "openai", model: "gpt-4.1" }, { provider: "openai-codex", model: "gpt-6-luna" }],
		[{ provider: "openai-codex", model: "gpt-6-luna" }, { provider: "openai", model: "gpt-4.1" }],
	]) {
		assert.equal(await selectExtractionModel(current, registry, {
			...DEFAULT_ANSWER_CONFIG,
			modelPriority: refs,
		}), refs[0].provider === "openai" ? current : codex);
	}
});

test("selectExtractionModel respects an explicit empty priority override", async () => {
	const registry = createRegistry({
		available: { "openai-codex/gpt-6-luna": codex },
		auth: {
			"openai-codex/gpt-6-luna": authenticated,
			"openai/gpt-4.1": authenticated,
		},
	});
	assert.equal(await selectExtractionModel(current, registry, {
		...DEFAULT_ANSWER_CONFIG,
		modelPriority: [],
	}), current);
});

for (const present of [false, true]) {
	test(`selectExtractionModel falls back to current when Codex Luna is ${present ? "unauthenticated" : "absent"}`, async () => {
		const registry = createRegistry({
			available: present ? { "openai-codex/gpt-6-luna": codex } : {},
			auth: { "openai/gpt-4.1": authenticated },
		});
		assert.equal(await selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG), current);
	});
}

test("selectExtractionModel looks up only Codex Luna with default config", async () => {
	const registry = createRegistry({ auth: { "openai/gpt-4.1": authenticated } });
	const lookups = [];
	registry.find = (provider, model) => {
		lookups.push(`${provider}/${model}`);
		return null;
	};
	assert.equal(await selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG), current);
	assert.deepEqual(lookups, ["openai-codex/gpt-6-luna"]);
});

test("selectExtractionModel honors disabled current-model fallback", async () => {
	const registry = createRegistry({ auth: { "openai/gpt-4.1": authenticated } });
	await assert.rejects(
		() => selectExtractionModel(current, registry, { ...DEFAULT_ANSWER_CONFIG, fallbackToCurrentModel: false }),
		/no usable extraction model found.*openai-codex\/gpt-6-luna \(not found\)/i,
	);
});

test("selectExtractionModel throws clear error when nothing is usable", async () => {
	await assert.rejects(
		() => selectExtractionModel(current, createRegistry(), DEFAULT_ANSWER_CONFIG),
		/no usable extraction model found/i,
	);
});
