import type { Api, Model, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "../lib/pi-ai-compat.ts";
import { BorderedLoader } from "../lib/pi-coding-agent-compat.ts";
import { loadAnswerConfig } from "./config.ts";
import { selectExtractionModel } from "./model-selection.ts";
import { selectSourceText } from "./source-selection.ts";
import { QnAComponent } from "./ui.ts";
import type { ExtractionResult } from "./ui.ts";

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}

Example output:
{
  "questions": [
    {
      "question": "What is your preferred database?",
      "context": "We can only configure MySQL and PostgreSQL because of what is implemented."
    },
    {
      "question": "Should we use TypeScript or JavaScript?"
    }
  ]
}`;

function parseExtractionResult(text: string): ExtractionResult | null {
	try {
		let jsonStr = text;
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			jsonStr = jsonMatch[1].trim();
		}

		const parsed = JSON.parse(jsonStr);
		if (parsed && Array.isArray(parsed.questions)) {
			return parsed as ExtractionResult;
		}
		return null;
	} catch {
		return null;
	}
}

async function extractQuestions(
	ctx: ExtensionContext,
	sourceText: string,
	extractionModel: Model<Api>,
	loaderSignal: AbortSignal,
	reasoningLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
): Promise<ExtractionResult | null> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(extractionModel);
	if (!auth.ok) {
		throw new Error(auth.error);
	}

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: sourceText }],
		timestamp: Date.now(),
	};

	const response = await completeSimple(
		extractionModel,
		{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal: loaderSignal,
			reasoning: reasoningLevel && reasoningLevel !== "off" ? reasoningLevel : undefined,
		},
	);

	if (response.stopReason === "aborted") {
		return null;
	}

	const responseText = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return parseExtractionResult(responseText);
}

export default function answerExtension(pi: ExtensionAPI) {
	const answerHandler = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("answer requires interactive mode", "error");
			return;
		}

		if (!ctx.model) {
			ctx.ui.notify("No model selected", "error");
			return;
		}

		const { config, warnings } = loadAnswerConfig();
		for (const warning of warnings) {
			console.warn(`[answer] ${warning}`);
		}

		let sourceText: string;
		try {
			sourceText = selectSourceText(ctx, config.source);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}

		let extractionModel: Model<Api>;
		try {
			extractionModel = await selectExtractionModel(ctx.model, ctx.modelRegistry, config);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}

		const extractionResult = await ctx.ui.custom<ExtractionResult | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, `Extracting questions using ${extractionModel.id}...`);
			loader.onAbort = () => done(null);

			extractQuestions(ctx, sourceText, extractionModel, loader.signal, config.thinkingLevel)
				.then(done)
				.catch((error) => {
					console.error(`[answer] extraction failed: ${String(error)}`);
					done(null);
				});

			return loader;
		});

		if (extractionResult === null) {
			ctx.ui.notify("Cancelled", "info");
			return;
		}

		if (extractionResult.questions.length === 0) {
			ctx.ui.notify(config.source === "last-assistant" ? "No questions found in the last message" : "No questions found in selected source text", "info");
			return;
		}

		const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
			return new QnAComponent(extractionResult.questions, tui, done);
		});

		if (answersResult === null) {
			ctx.ui.notify("Cancelled", "info");
			return;
		}

		pi.sendMessage(
			{
				customType: "answers",
				content: "I answered your questions in the following way:\n\n" + answersResult,
				display: true,
			},
			{ triggerTurn: true },
		);
	};

	pi.registerCommand("answer", {
		description: "Extract questions from last assistant message into interactive Q&A",
		handler: (_args, ctx) => answerHandler(ctx),
	});

	pi.registerShortcut("ctrl+.", {
		description: "Extract and answer questions",
		handler: answerHandler,
	});
}
