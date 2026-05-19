import { execFile } from "node:child_process";
import { readFile as defaultReadFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createDiffProvider } from "./git.ts";
import { completeSubmissionRound, submitReview } from "./state.ts";
import type { ReviewSession } from "./types.ts";

const execFileAsync = promisify(execFile);
const staticRoot = fileURLToPath(new URL("./static/", import.meta.url));

class ReviewServerHttpError extends Error {
	statusCode: number;
	code: string;

	constructor(statusCode: number, code: string, message: string) {
		super(message);
		this.statusCode = statusCode;
		this.code = code;
	}
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function sendText(res: import("node:http").ServerResponse, status: number, body: string, contentType: string) {
	res.writeHead(status, { "content-type": `${contentType}; charset=utf-8` });
	res.end(body);
}

function guessContentType(filePath: string) {
	if (filePath.endsWith(".html")) return "text/html";
	if (filePath.endsWith(".js")) return "text/javascript";
	if (filePath.endsWith(".css")) return "text/css";
	if (filePath.endsWith(".json")) return "application/json";
	if (filePath.endsWith(".svg")) return "image/svg+xml";
	return "text/plain";
}

async function serveStaticAsset(res: import("node:http").ServerResponse, pathname: string) {
	const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
	const resolvedPath = path.resolve(staticRoot, relativePath);
	if (!resolvedPath.startsWith(staticRoot)) {
		return json(res, 404, { error: "not found" });
	}
	const body = await defaultReadFile(resolvedPath, "utf8");
	sendText(res, 200, body, guessContentType(resolvedPath));
}

function getSecret(url: URL) {
	return url.searchParams.get("secret") ?? "";
}

function isAuthorized(url: URL, serverSecret: string) {
	return getSecret(url) === serverSecret;
}

async function readJsonBody(req: import("node:http").IncomingMessage) {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function ensureRepoReady(repoRoot: string) {
	try {
		await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8" });
	} catch {
		throw new ReviewServerHttpError(400, "not-a-git-repo", `Not a git repo: ${repoRoot}`);
	}
	try {
		await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
	} catch {
		throw new ReviewServerHttpError(400, "missing-head", `Git repo at ${repoRoot} is missing HEAD`);
	}
}

async function withProvider(
	session: ReviewSession,
	deps: {
		readFileImpl?: typeof defaultReadFile;
		createDiffProvider?: typeof createDiffProvider;
	},
	action: (provider: Awaited<ReturnType<typeof createDiffProvider>>) => Promise<void>,
) {
	await ensureRepoReady(session.repoRoot);
	const makeProvider = deps.createDiffProvider ?? createDiffProvider;
	const provider = await makeProvider({
		repoRoot: session.repoRoot,
		diffMode: session.diffMode,
		readFileImpl: deps.readFileImpl,
	});
	await action(provider);
}

function toSessionState(session: ReviewSession) {
	return {
		reviewSessionId: session.reviewSessionId,
		repoRoot: session.repoRoot,
		diffMode: session.diffMode,
		pendingSubmission: session.pendingSubmission,
		submissionHistory: session.submissionHistory,
	};
}

export async function startReviewServer(
	session: ReviewSession,
	deps: {
		store: {
			subscribe(reviewSessionId: string, listener: (event: { type: string; payload: unknown }) => void): () => void;
			emitSessionState(session: ReviewSession): void;
			getById(reviewSessionId: string): ReviewSession | null;
		};
		isPiIdle(): boolean;
		sendUserMessage(prompt: string): Promise<void> | void;
		readFileImpl?: typeof defaultReadFile;
		createDiffProvider?: typeof createDiffProvider;
		beforeSubmit?: () => Promise<void> | void;
		port?: number;
	},
) {
	const eventStreams = new Set<import("node:http").ServerResponse>();
	let submitInFlight = false;
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if ((req.method === "GET" && url.pathname === "/") || (req.method === "GET" && url.pathname.startsWith("/assets/"))) {
				return await serveStaticAsset(res, url.pathname);
			}
			if (url.pathname.startsWith("/api/") && !isAuthorized(url, session.serverSecret)) {
				return json(res, 403, { error: "invalid review secret" });
			}
			if (req.method === "GET" && url.pathname === "/api/events") {
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				res.write(`event: session-state\ndata: ${JSON.stringify(toSessionState(session))}\n\n`);
				eventStreams.add(res);
				req.on("close", () => eventStreams.delete(res));
				return;
			}
			if (req.method === "GET" && url.pathname === "/api/session") {
				return await withProvider(session, deps, async (provider) => {
					const [mode, tree] = await Promise.all([provider.loadModeState(), provider.loadTree()]);
					json(res, 200, { ...toSessionState(session), ...mode, ...tree, files: session.files, threads: session.threads });
				});
			}
			if (req.method === "GET" && url.pathname === "/api/tree") {
				return await withProvider(session, deps, async (provider) => {
					json(res, 200, await provider.loadTree());
				});
			}
			if (req.method === "GET" && url.pathname === "/api/file") {
				const filePath = url.searchParams.get("path");
				if (!filePath) return json(res, 400, { error: "path is required" });
				return await withProvider(session, deps, async (provider) => {
					json(res, 200, await provider.loadFile(filePath));
				});
			}
			if (req.method === "POST" && url.pathname === "/api/diff-mode") {
				const body = await readJsonBody(req);
				if (body.requestedMode !== "working-tree-vs-head" && body.requestedMode !== "merge-base-vs-head") {
					return json(res, 400, { error: "requestedMode is required" });
				}
				session.diffMode = body.requestedMode;
				return await withProvider(session, deps, async (provider) => {
					const mode = await provider.loadModeState();
					json(res, 200, mode);
				});
			}
			if (req.method === "POST" && url.pathname === "/api/submit") {
				if (session.pendingSubmission || submitInFlight) {
					return json(res, 409, { error: "review submission already pending" });
				}
				if (!deps.isPiIdle()) {
					return json(res, 409, { error: "Pi session is busy" });
				}
				submitInFlight = true;
				try {
					await deps.beforeSubmit?.();
					const round = await submitReview(session, async (prompt) => {
						await deps.sendUserMessage(prompt);
					});
					deps.store.emitSessionState(session);
					return json(res, 200, { roundId: round.id, pendingSubmission: session.pendingSubmission });
				} finally {
					submitInFlight = false;
				}
			}
			const completeMatch = /^\/api\/rounds\/([^/]+)\/complete$/.exec(url.pathname);
			if (req.method === "POST" && completeMatch) {
				completeSubmissionRound(session, decodeURIComponent(completeMatch[1]));
				deps.store.emitSessionState(session);
				return json(res, 200, { pendingSubmission: session.pendingSubmission, submissionHistory: session.submissionHistory });
			}
			return json(res, 404, { error: "not found" });
		} catch (error) {
			if (error instanceof ReviewServerHttpError) {
				return json(res, error.statusCode, { error: error.message, code: error.code });
			}
			const message = error instanceof Error ? error.message : String(error);
			return json(res, 500, { error: message });
		}
	});

	const unsubscribe = deps.store.subscribe(session.reviewSessionId, (event) => {
		const payload = event.type === "session-state" ? toSessionState(event.payload as ReviewSession) : event.payload;
		for (const stream of eventStreams) {
			stream.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", (error: NodeJS.ErrnoException) => {
			unsubscribe();
			if (error?.code === "EADDRINUSE") {
				reject(new Error(`Port conflict on 127.0.0.1:${deps.port ?? 0}`));
				return;
			}
			reject(error);
		});
		server.listen(deps.port ?? 0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		unsubscribe();
		throw new Error("Failed to determine diff review server address");
	}

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		async close() {
			unsubscribe();
			for (const stream of eventStreams) {
				stream.end();
			}
			eventStreams.clear();
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		},
	};
}
