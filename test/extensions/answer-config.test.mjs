import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_ANSWER_CONFIG,
	loadAnswerConfigFromPath,
} from "../../pi-extension/answer/config.ts";

test("loadAnswerConfigFromPath falls back to defaults for missing file", () => {
	const missing = join(tmpdir(), `missing-answer-config-${Date.now()}.json`);
	const result = loadAnswerConfigFromPath(missing);

	assert.deepEqual(result.config, DEFAULT_ANSWER_CONFIG);
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0], /Config file not found/);
});

test("loadAnswerConfigFromPath merges valid partial config with defaults", () => {
	const dir = mkdtempSync(join(tmpdir(), "answer-config-"));
	const path = join(dir, "answer.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				source: "last-user",
				fallbackToCurrentModel: false,
			},
			null,
			2,
		),
	);

	const result = loadAnswerConfigFromPath(path);
	assert.equal(result.config.source, "last-user");
	assert.equal(result.config.fallbackToCurrentModel, false);
	assert.deepEqual(result.config.modelPriority, DEFAULT_ANSWER_CONFIG.modelPriority);
	assert.equal(result.config.thinkingLevel, DEFAULT_ANSWER_CONFIG.thinkingLevel);
	assert.deepEqual(result.warnings, []);
});

test("loadAnswerConfigFromPath skips invalid model entries but keeps valid ones", () => {
	const dir = mkdtempSync(join(tmpdir(), "answer-config-"));
	const path = join(dir, "answer.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				modelPriority: [
					{ provider: "openai-codex", model: "gpt-5.4-mini" },
					{ provider: "", model: "bad" },
					"not-an-object",
				],
			},
			null,
			2,
		),
	);

	const result = loadAnswerConfigFromPath(path);
	assert.deepEqual(result.config.modelPriority, [{ provider: "openai-codex", model: "gpt-5.4-mini" }]);
	assert.equal(result.warnings.length, 2);
});

test("loadAnswerConfigFromPath accepts thinking level configuration", () => {
	const dir = mkdtempSync(join(tmpdir(), "answer-config-"));
	const path = join(dir, "answer.json");
	writeFileSync(
		path,
		JSON.stringify(
			{
				thinkingLevel: "low",
			},
			null,
			2,
		),
	);

	const result = loadAnswerConfigFromPath(path);
	assert.equal(result.config.thinkingLevel, "low");
	assert.deepEqual(result.warnings, []);
});

test("loadAnswerConfigFromPath uses defaults for malformed JSON", () => {
	const dir = mkdtempSync(join(tmpdir(), "answer-config-"));
	const path = join(dir, "answer.json");
	writeFileSync(path, "{ nope");

	const result = loadAnswerConfigFromPath(path);
	assert.deepEqual(result.config, DEFAULT_ANSWER_CONFIG);
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0], /Failed to parse/);
});
