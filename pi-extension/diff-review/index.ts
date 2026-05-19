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
	const pendingServerStarts = new Map<string, Promise<{ baseUrl: string; close(): Promise<void> | void }>>();

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
					let pending = pendingServerStarts.get(session.reviewSessionId);
					if (!pending) {
						pending = (async () => {
							const startedServer = await startServer(session, {
								store: reviewSessionStore,
								isPiIdle: () => ctx.isIdle(),
								sendUserMessage: (prompt) => pi.sendUserMessage(prompt),
							});
							if (reviewSessionStore.getById(session.reviewSessionId) !== session) {
								await startedServer.close();
								throw new Error(`Diff review session ${session.reviewSessionId} was closed during startup`);
							}
							reviewSessionStore.attachServer(session.reviewSessionId, startedServer);
							return startedServer;
						})();
						pendingServerStarts.set(session.reviewSessionId, pending);
						const clearPending = () => {
							if (pendingServerStarts.get(session.reviewSessionId) === pending) {
								pendingServerStarts.delete(session.reviewSessionId);
							}
						};
						pending.then(clearPending, clearPending);
					}
					server = await pending;
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
