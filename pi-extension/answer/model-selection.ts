import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AnswerConfig, AnswerModelRef } from "./config.ts";

interface SelectionFailure {
	candidate: string;
	reason: string;
}

function formatCandidate(model: AnswerModelRef): string {
	return `${model.provider}/${model.model}`;
}

function formatFailureSummary(failures: SelectionFailure[]): string {
	if (failures.length === 0) return "";
	return failures.map((failure) => `${failure.candidate} (${failure.reason})`).join(", ");
}

export async function selectExtractionModel(
	currentModel: Model<Api>,
	modelRegistry: ModelRegistry,
	config: AnswerConfig,
): Promise<Model<Api>> {
	const failures: SelectionFailure[] = [];

	for (const candidate of config.modelPriority) {
		const model = modelRegistry.find(candidate.provider, candidate.model);
		if (!model) {
			failures.push({ candidate: formatCandidate(candidate), reason: "not found" });
			continue;
		}

		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			failures.push({ candidate: formatCandidate(candidate), reason: auth.error || "not authenticated" });
			continue;
		}

		return model;
	}

	if (config.fallbackToCurrentModel) {
		const auth = await modelRegistry.getApiKeyAndHeaders(currentModel);
		if (auth.ok) {
			return currentModel;
		}

		failures.push({
			candidate: `${currentModel.provider}/${currentModel.id}`,
			reason: auth.error || "current model not authenticated",
		});
	}

	const summary = formatFailureSummary(failures);
	throw new Error(
		summary.length > 0
			? `No usable extraction model found: ${summary}`
			: "No usable extraction model found.",
	);
}
