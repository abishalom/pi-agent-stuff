import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

const ROOT = join(import.meta.dirname, "../..");
const CLEANUP_PROMPT = join(ROOT, "prompts/cleanup-subagents.md");

test("package loads the /cleanup-subagents prompt template", async () => {
	const prompt = await readFile(CLEANUP_PROMPT, "utf8");
	assert.match(prompt, /^---\ndescription: .+\n---\n/);

	const loader = new DefaultResourceLoader({
		cwd: ROOT,
		agentDir: getAgentDir(),
		settingsManager: SettingsManager.inMemory(),
		additionalPromptTemplatePaths: [join(ROOT, "prompts")],
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const loaded = loader.getPrompts();
	const cleanup = loaded.prompts.find((item) => item.filePath === CLEANUP_PROMPT);
	assert.equal(cleanup?.name, "cleanup-subagents");
	assert.ok(!loaded.diagnostics.some((item) => item.path === CLEANUP_PROMPT));
});

test("/cleanup-subagents closes only finished, role-tagged Herdr subagents", async () => {
	const prompt = await readFile(CLEANUP_PROMPT, "utf8");
	assert.match(prompt, /HERDR_ENV=1/);
	assert.match(prompt, /herdr pane list/);
	assert.match(prompt, /tokens\.role/);
	assert.match(prompt, /agent_status` of `idle` or `done`/);
	assert.match(prompt, /working`, `blocked`, or `unknown/);
	assert.match(prompt, /untagged Pi panes, shells/);
	assert.match(prompt, /herdr pane close <pane-id>/);
	assert.match(prompt, /Do not interrupt agents/);
});
