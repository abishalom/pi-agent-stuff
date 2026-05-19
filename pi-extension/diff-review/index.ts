import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDiffReviewReplyTool } from "./reply-tool.ts";
import { createReviewSessionStore } from "./state.ts";
import { startReviewServer } from "./server.ts";
import { shutdownSessionsForPiSessionKey } from "./cleanup.ts";
import { createDiffProvider } from "./git.ts";

const execFileAsync = promisify(execFile);

async function resolveRepoRoot(cwd: string) {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
		return stdout.trim();
	} catch (error) {
		throw new Error(`Current directory is not inside a git repo: ${cwd}`);
	}
}

export function createDiffReviewExtension(deps?: {
	startServer?: typeof startReviewServer;
	shutdownSessionsForPiSessionKey?: typeof shutdownSessionsForPiSessionKey;
}) {
	const reviewSessionStore = createReviewSessionStore();
	const startServer = deps?.startServer ?? startReviewServer;
	const shutdown = deps?.shutdownSessionsForPiSessionKey ?? shutdownSessionsForPiSessionKey;

	return function diffReviewExtension(pi: ExtensionAPI) {
		pi.registerCommand("diff-review", {
			description: "Open the local diff review workflow",
			handler: async (_args, ctx) => {
				const repoRoot = await resolveRepoRoot(ctx.cwd);
				const session = reviewSessionStore.create({
					piSessionKey: ctx.piSessionKey,
					repoRoot,
					diffMode: "working-tree-vs-head",
				});
				await (await createDiffProvider({ repoRoot, diffMode: session.diffMode })).loadModeState();
				let server = reviewSessionStore.getServer(session.reviewSessionId);
				if (!server) {
					server = await startServer(session, {
						store: reviewSessionStore,
						isPiIdle: () => ctx.isIdle(),
						sendUserMessage: (prompt) => pi.sendUserMessage(prompt),
					});
					reviewSessionStore.attachServer(session.reviewSessionId, server);
				}
				ctx.ui.notify(`Diff review ready: ${server.baseUrl}?secret=${session.serverSecret}`, "info");
			},
		});

		pi.on("session_shutdown", async (_event, ctx) => {
			await shutdown(reviewSessionStore, ctx.piSessionKey);
		});

		registerDiffReviewReplyTool(pi, reviewSessionStore);
	};
}

export default createDiffReviewExtension();
