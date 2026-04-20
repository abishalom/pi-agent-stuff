import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AnswerSourceMode = "last-assistant" | "last-user" | "last-turn" | "whole-branch";

export interface AnswerModelRef {
	provider: string;
	model: string;
}

export type AnswerThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AnswerConfig {
	source: AnswerSourceMode;
	modelPriority: AnswerModelRef[];
	fallbackToCurrentModel: boolean;
	thinkingLevel?: AnswerThinkingLevel;
}

export interface LoadedAnswerConfig {
	config: AnswerConfig;
	path: string;
	warnings: string[];
}

const VALID_SOURCE_MODES = new Set<AnswerSourceMode>([
	"last-assistant",
	"last-user",
	"last-turn",
	"whole-branch",
]);

const VALID_THINKING_LEVELS = new Set<AnswerThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const extensionDir = dirname(fileURLToPath(import.meta.url));
export const defaultAnswerConfigPath = join(extensionDir, "../../config/answer.json");

export const DEFAULT_ANSWER_CONFIG: AnswerConfig = {
	source: "last-assistant",
	modelPriority: [
		{ provider: "github-copilot", model: "gpt-5.4-mini" },
		{ provider: "openai-codex", model: "gpt-5.4-mini" },
	],
	fallbackToCurrentModel: true,
	thinkingLevel: "low",
};

function cloneDefaultConfig(): AnswerConfig {
	return {
		source: DEFAULT_ANSWER_CONFIG.source,
		modelPriority: DEFAULT_ANSWER_CONFIG.modelPriority.map((model) => ({ ...model })),
		fallbackToCurrentModel: DEFAULT_ANSWER_CONFIG.fallbackToCurrentModel,
		thinkingLevel: DEFAULT_ANSWER_CONFIG.thinkingLevel,
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validateModelPriority(value: unknown, warnings: string[]): AnswerModelRef[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		warnings.push("modelPriority must be an array; using default model priority.");
		return cloneDefaultConfig().modelPriority;
	}

	const result: AnswerModelRef[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = value[index];
		if (!entry || typeof entry !== "object") {
			warnings.push(`modelPriority[${index}] must be an object with provider and model; skipping invalid entry.`);
			continue;
		}

		const provider = "provider" in entry ? entry.provider : undefined;
		const model = "model" in entry ? entry.model : undefined;
		if (!isNonEmptyString(provider) || !isNonEmptyString(model)) {
			warnings.push(`modelPriority[${index}] must contain non-empty provider and model strings; skipping invalid entry.`);
			continue;
		}

		result.push({ provider: provider.trim(), model: model.trim() });
	}

	return result;
}

export function loadAnswerConfigFromPath(configPath = defaultAnswerConfigPath): LoadedAnswerConfig {
	const warnings: string[] = [];
	const config = cloneDefaultConfig();

	if (!existsSync(configPath)) {
		warnings.push(`Config file not found at ${configPath}; using defaults.`);
		return { config, path: configPath, warnings };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf8"));
	} catch (error) {
		warnings.push(`Failed to parse ${configPath}; using defaults. ${String(error)}`);
		return { config, path: configPath, warnings };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		warnings.push(`Config at ${configPath} must be a JSON object; using defaults.`);
		return { config, path: configPath, warnings };
	}

	if ("source" in parsed) {
		if (typeof parsed.source === "string" && VALID_SOURCE_MODES.has(parsed.source as AnswerSourceMode)) {
			config.source = parsed.source as AnswerSourceMode;
		} else {
			warnings.push(`Invalid source ${JSON.stringify(parsed.source)}; using default source ${JSON.stringify(config.source)}.`);
		}
	}

	const modelPriority = validateModelPriority("modelPriority" in parsed ? parsed.modelPriority : undefined, warnings);
	if (modelPriority !== undefined) {
		config.modelPriority = modelPriority;
	}

	if ("fallbackToCurrentModel" in parsed) {
		if (typeof parsed.fallbackToCurrentModel === "boolean") {
			config.fallbackToCurrentModel = parsed.fallbackToCurrentModel;
		} else {
			warnings.push(
				`fallbackToCurrentModel must be a boolean; using default ${JSON.stringify(config.fallbackToCurrentModel)}.`,
			);
		}
	}

	if ("thinkingLevel" in parsed) {
		if (typeof parsed.thinkingLevel === "string" && VALID_THINKING_LEVELS.has(parsed.thinkingLevel as AnswerThinkingLevel)) {
			config.thinkingLevel = parsed.thinkingLevel as AnswerThinkingLevel;
		} else {
			warnings.push(
				`thinkingLevel must be one of off, minimal, low, medium, high, xhigh; using default ${JSON.stringify(config.thinkingLevel)}.`,
			);
		}
	}

	return { config, path: configPath, warnings };
}

export function loadAnswerConfig(): LoadedAnswerConfig {
	return loadAnswerConfigFromPath(defaultAnswerConfigPath);
}
