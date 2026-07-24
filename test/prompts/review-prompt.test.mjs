import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

const ROOT = join(import.meta.dirname, "../..");
const REVIEW_PROMPT = join(ROOT, "prompts/review.md");

test("package loads the /review prompt template", async () => {
	assert.ok(packageJson.pi.prompts.includes("./prompts"));
	const prompt = await readFile(REVIEW_PROMPT, "utf8");
	assert.match(prompt, /^---\ndescription: .+\nargument-hint: "\[spec path or review instructions\]"\n---\n/);

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
	const review = loaded.prompts.find((item) => item.filePath === REVIEW_PROMPT);
	assert.equal(review?.name, "review");
	assert.equal(review?.argumentHint, "[spec path or review instructions]");
	assert.ok(!loaded.diagnostics.some((item) => item.path === REVIEW_PROMPT));
});

test("/review preflights standards, requirements, and one shared Hunk session", async () => {
	const prompt = await readFile(REVIEW_PROMPT, "utf8");
	assert.match(prompt, /current uncommitted working tree/i);
	assert.match(prompt, /If no standards source exists[\s\S]*ask the user/i);
	assert.match(prompt, /If no meaningful requirements source[\s\S]*ask the user/i);
	assert.match(prompt, /exactly one shared Hunk session/i);
	assert.match(prompt, /hunk skill path/);
	assert.match(prompt, /hunk diff --watch/);
});

test("/review dispatches two independent reviewers and aggregates both axes", async () => {
	const prompt = await readFile(REVIEW_PROMPT, "utf8");
	assert.match(prompt, /exactly two `reviewer` subagents/i);
	assert.match(prompt, /Name it `Standards review`/);
	assert.match(prompt, /Name it `Requirements review`/);
	assert.match(prompt, /agent: "reviewer"/);
	assert.match(prompt, /\[Standards\]/);
	assert.match(prompt, /\[Requirements\]/);
	assert.match(prompt, /get_subagent_result` at most once/i);
	assert.match(prompt, /## Standards/);
	assert.match(prompt, /## Requirements/);
	assert.match(prompt, /Do not launch workers or apply fixes/i);
});
