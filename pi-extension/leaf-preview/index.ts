import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "leaf";
const PREVIEW_PREFIX = "pi-leaf-";

type SplitDirection = "right" | "down";

interface HerdrEnvelope {
	result?: {
		pane?: {
			pane_id?: unknown;
		};
	};
	error?: {
		message?: unknown;
	};
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function latestAssistantText(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason !== "stop") {
			throw new Error(`Last assistant message incomplete (${entry.message.stopReason})`);
		}
		if (!Array.isArray(entry.message.content)) continue;
		const text = entry.message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join("\n");
		if (text.trim()) return text;
	}
	throw new Error("No assistant messages found");
}

function parseDirection(args: string): SplitDirection {
	const direction = args.trim();
	if (!direction || direction === "right") return "right";
	if (direction === "down") return "down";
	throw new Error("Usage: /leaf [right|down]");
}

function parseSplitPaneId(output: string): string {
	let response: HerdrEnvelope;
	try {
		response = JSON.parse(output) as HerdrEnvelope;
	} catch {
		throw new Error(`Herdr returned malformed JSON while creating Leaf preview: ${output.trim() || "(empty output)"}`);
	}

	if (typeof response.error?.message === "string") {
		throw new Error(`Herdr could not create Leaf preview: ${response.error.message}`);
	}

	const paneId = response.result?.pane?.pane_id;
	if (typeof paneId !== "string" || !paneId) {
		throw new Error("Herdr did not return a pane ID for the Leaf preview");
	}
	return paneId;
}

async function assertLeafAvailable(pi: Pick<ExtensionAPI, "exec">): Promise<void> {
	try {
		const result = await pi.exec("leaf", ["--version"], { timeout: 5_000 });
		if (result.code === 0) return;
	} catch {
		// Fall through to the same actionable error for spawn and command failures.
	}
	throw new Error("Leaf is not installed or is not on PATH. Install Leaf, then retry /leaf.");
}

async function runHerdr(pi: Pick<ExtensionAPI, "exec">, args: string[]): Promise<string> {
	const result = await pi.exec("herdr", args, { timeout: 10_000 });
	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		throw new Error(`herdr ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
	}
	return result.stdout;
}

async function createPreviewFile(text: string): Promise<{ directory: string; path: string }> {
	const directory = await mkdtemp(join(tmpdir(), PREVIEW_PREFIX));
	try {
		await chmod(directory, 0o700);
		const path = join(directory, "message.md");
		await writeFile(path, `${text.trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
		return { directory, path };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

function previewCommand(path: string, directory: string): string {
	return [
		`leaf -- ${shellQuote(path)}`,
		"status=$?",
		`rm -rf -- ${shellQuote(directory)}`,
		'exit "$status"',
	].join("; ");
}

export interface LeafPreviewOptions {
	env?: NodeJS.ProcessEnv;
}

export function createLeafPreviewExtension(options: LeafPreviewOptions = {}) {
	const env = options.env ?? process.env;
	let activePreviewPaneId: string | undefined;

	return function leafPreviewExtension(pi: ExtensionAPI): void {
		pi.registerCommand(COMMAND_NAME, {
			description: "Preview the latest assistant message in Leaf in a temporary Herdr split",
			handler: async (args, ctx) => {
				if (ctx.mode !== "tui") {
					throw new Error("/leaf requires Pi's interactive TUI mode");
				}
				if (env.HERDR_ENV !== "1" || !env.HERDR_PANE_ID) {
					throw new Error("/leaf requires Pi to run inside a Herdr pane");
				}

				const direction = parseDirection(args);
				await assertLeafAvailable(pi);
				const text = latestAssistantText(ctx);
				const preview = await createPreviewFile(text);
				let paneId: string | undefined;

				try {
					if (activePreviewPaneId) {
						await runHerdr(pi, ["pane", "close", activePreviewPaneId]).catch(() => {});
						activePreviewPaneId = undefined;
					}

					const splitOutput = await runHerdr(pi, [
						"pane", "split",
						"--pane", env.HERDR_PANE_ID,
						"--direction", direction,
						"--cwd", ctx.cwd,
						"--focus",
					]);
					paneId = parseSplitPaneId(splitOutput);
					activePreviewPaneId = paneId;

					await runHerdr(pi, ["pane", "rename", paneId, "Leaf preview"]);
					await runHerdr(pi, ["pane", "run", paneId, previewCommand(preview.path, preview.directory)]);
				} catch (error) {
					if (paneId) {
						await runHerdr(pi, ["pane", "close", paneId]).catch(() => {});
						if (activePreviewPaneId === paneId) activePreviewPaneId = undefined;
					}
					await rm(preview.directory, { recursive: true, force: true });
					throw error;
				}
			},
		});
	};
}

export { assertLeafAvailable, latestAssistantText, parseDirection, parseSplitPaneId, previewCommand, shellQuote };

export default createLeafPreviewExtension();
