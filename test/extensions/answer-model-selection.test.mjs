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

test("selectExtractionModel returns first configured authenticated model", async () => {
	const copilot = { provider: "github-copilot", id: "gpt-5.4-mini" };
	const codex = { provider: "openai-codex", id: "gpt-5.4-mini" };
	const current = { provider: "openai", id: "gpt-4.1" };
	const registry = createRegistry({
		available: {
			"github-copilot/gpt-5.4-mini": copilot,
			"openai-codex/gpt-5.4-mini": codex,
		},
		auth: {
			"github-copilot/gpt-5.4-mini": { ok: true, apiKey: "copilot-key", headers: {} },
			"openai-codex/gpt-5.4-mini": { ok: true, apiKey: "codex-key", headers: {} },
			"openai/gpt-4.1": { ok: true, apiKey: "current-key", headers: {} },
		},
	});

	const selected = await selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG);
	assert.equal(selected, copilot);
});

test("selectExtractionModel respects config priority changes", async () => {
	const copilot = { provider: "github-copilot", id: "gpt-5.4-mini" };
	const codex = { provider: "openai-codex", id: "gpt-5.4-mini" };
	const current = { provider: "openai", id: "gpt-4.1" };
	const registry = createRegistry({
		available: {
			"github-copilot/gpt-5.4-mini": copilot,
			"openai-codex/gpt-5.4-mini": codex,
		},
		auth: {
			"github-copilot/gpt-5.4-mini": { ok: true, apiKey: "copilot-key", headers: {} },
			"openai-codex/gpt-5.4-mini": { ok: true, apiKey: "codex-key", headers: {} },
			"openai/gpt-4.1": { ok: true, apiKey: "current-key", headers: {} },
		},
	});

	const selected = await selectExtractionModel(current, registry, {
		...DEFAULT_ANSWER_CONFIG,
		modelPriority: [{ provider: "openai-codex", model: "gpt-5.4-mini" }, { provider: "github-copilot", model: "gpt-5.4-mini" }],
	});
	assert.equal(selected, codex);
});

test("selectExtractionModel falls back to current model when configured models are unusable", async () => {
	const current = { provider: "openai", id: "gpt-4.1" };
	const registry = createRegistry({
		auth: {
			"openai/gpt-4.1": { ok: true, apiKey: "current-key", headers: {} },
		},
	});

	const selected = await selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG);
	assert.equal(selected, current);
});

test("selectExtractionModel throws clear error when nothing is usable", async () => {
	const current = { provider: "openai", id: "gpt-4.1" };
	const registry = createRegistry({
		auth: {
			"openai/gpt-4.1": { ok: false, error: "missing auth" },
		},
	});

	await assert.rejects(
		() => selectExtractionModel(current, registry, DEFAULT_ANSWER_CONFIG),
		/no usable extraction model found/i,
	);
});
