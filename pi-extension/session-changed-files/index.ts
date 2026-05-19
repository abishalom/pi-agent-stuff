import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "../lib/pi-tui-compat.ts";

const STATUS_KEY = "session-changed-files";
const RESET_ENTRY_TYPE = "session-changed-files-reset";

type FileKind = "modified" | "new" | "deleted";

interface OperationSummary {
	path: string;
	added: number;
	removed: number;
	kind?: FileKind;
}

interface FileStats {
	path: string;
	added: number;
	removed: number;
	changeCount: number;
	kind: FileKind;
}

interface PersistedToolDetails {
	sessionChangedFiles?: OperationSummary;
	[key: string]: unknown;
}

interface PendingWriteSnapshot {
	displayPath: string;
	before: string;
	existedBefore: boolean;
}

function stripAtPrefix(filePath: string): string {
	return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

function toAbsolutePath(cwd: string, filePath: string): string {
	return path.resolve(cwd, stripAtPrefix(filePath));
}

function toDisplayPath(cwd: string, absolutePath: string): string {
	const relative = path.relative(cwd, absolutePath);
	if (!relative || relative === "") return path.basename(absolutePath);
	return relative.startsWith("..") ? absolutePath : relative;
}

function countDiffFromUnifiedDiff(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
		if (line.startsWith("+")) added++;
		if (line.startsWith("-")) removed++;
	}

	return { added, removed };
}

function writeTempFile(prefix: string, content: string): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-changed-files-"));
	const filePath = path.join(tempDir, `${prefix}.txt`);
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

function fallbackLineCount(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length;
}

function countDiffBetweenContents(before: string, after: string): { added: number; removed: number } {
	const beforeFile = writeTempFile("before", before);
	const afterFile = writeTempFile("after", after);

	try {
		const output = execFileSync("git", ["diff", "--no-index", "--numstat", "--", beforeFile, afterFile], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const firstLine = output.trim().split("\n")[0] ?? "";
		const [addedText, removedText] = firstLine.split("\t");
		const added = Number.parseInt(addedText ?? "0", 10);
		const removed = Number.parseInt(removedText ?? "0", 10);
		return {
			added: Number.isFinite(added) ? added : 0,
			removed: Number.isFinite(removed) ? removed : 0,
		};
	} catch (error) {
		const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
		const firstLine = stdout.trim().split("\n")[0] ?? "";
		const [addedText, removedText] = firstLine.split("\t");
		const added = Number.parseInt(addedText ?? "0", 10);
		const removed = Number.parseInt(removedText ?? "0", 10);
		return {
			added: Number.isFinite(added) ? added : before.length === 0 ? fallbackLineCount(after) : 0,
			removed: Number.isFinite(removed) ? removed : after.length === 0 ? fallbackLineCount(before) : 0,
		};
	} finally {
		fs.rmSync(path.dirname(beforeFile), { recursive: true, force: true });
		fs.rmSync(path.dirname(afterFile), { recursive: true, force: true });
	}
}

function coerceOperationSummary(value: unknown): OperationSummary | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<OperationSummary>;
	if (typeof candidate.path !== "string") return null;
	const added = typeof candidate.added === "number" && Number.isFinite(candidate.added) ? candidate.added : 0;
	const removed = typeof candidate.removed === "number" && Number.isFinite(candidate.removed) ? candidate.removed : 0;
	const kind = candidate.kind === "new" || candidate.kind === "deleted" || candidate.kind === "modified" ? candidate.kind : undefined;
	return { path: candidate.path, added, removed, kind };
}

function applyOperation(stats: Map<string, FileStats>, op: OperationSummary): void {
	const existing = stats.get(op.path);
	if (existing) {
		existing.added += op.added;
		existing.removed += op.removed;
		existing.changeCount += 1;
		if (existing.kind !== "deleted" && op.kind) {
			existing.kind = op.kind;
		}
		return;
	}

	stats.set(op.path, {
		path: op.path,
		added: op.added,
		removed: op.removed,
		changeCount: 1,
		kind: op.kind ?? "modified",
	});
}

function totals(stats: Map<string, FileStats>): { files: number; added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const file of stats.values()) {
		added += file.added;
		removed += file.removed;
	}
	return { files: stats.size, added, removed };
}

function sortedFiles(stats: Map<string, FileStats>): FileStats[] {
	const rank = (kind: FileKind) => {
		if (kind === "new") return 0;
		if (kind === "deleted") return 1;
		return 2;
	};

	return [...stats.values()].sort((a, b) => {
		const kindDiff = rank(a.kind) - rank(b.kind);
		if (kindDiff !== 0) return kindDiff;
		const churnDiff = b.added + b.removed - (a.added + a.removed);
		if (churnDiff !== 0) return churnDiff;
		return a.path.localeCompare(b.path);
	});
}

function formatSummary(theme: Theme, stats: Map<string, FileStats>, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const total = totals(stats);
	if (total.files === 0) {
		return [truncateToWidth(theme.fg("dim", "Changed this session: none"), safeWidth)];
	}

	const lines = [
		truncateToWidth(
			`${theme.fg("accent", "Changed this session")} ${theme.fg("dim", `${total.files} file${total.files === 1 ? "" : "s"}`)} ${theme.fg("success", `+${total.added}`)} ${theme.fg("error", `-${total.removed}`)}`,
			safeWidth,
		),
	];

	for (const file of sortedFiles(stats).slice(0, 6)) {
		const labelText = file.kind === "new" ? "new" : file.kind === "deleted" ? "deleted" : "mod";
		const label =
			file.kind === "new"
				? theme.fg("success", labelText)
				: file.kind === "deleted"
					? theme.fg("error", labelText)
					: theme.fg("dim", labelText);
		const pathColor = file.kind === "new" ? "success" : file.kind === "deleted" ? "error" : "text";
		const suffix = `${theme.fg("success", `+${file.added}`)} ${theme.fg("error", `-${file.removed}`)}`;
		const reserved = visibleWidth(label) + 1 + 1 + visibleWidth(suffix);
		const availableForPath = safeWidth - reserved;
		const pathText = availableForPath >= 4
			? theme.fg(pathColor, truncateToWidth(file.path, availableForPath))
			: theme.fg(pathColor, truncateToWidth(file.path, safeWidth));
		const line = availableForPath >= 4
			? `${label} ${pathText} ${suffix}`
			: `${label} ${pathText}`;
		lines.push(truncateToWidth(line, safeWidth));
	}

	return lines;
}

function formatReport(theme: Theme, stats: Map<string, FileStats>, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const total = totals(stats);
	const files = sortedFiles(stats);
	const rows: string[] = [];
	rows.push(truncateToWidth(theme.fg("accent", `Changed this session: ${total.files} file${total.files === 1 ? "" : "s"}`), safeWidth));
	rows.push(truncateToWidth(`${theme.fg("success", `+${total.added}`)} ${theme.fg("error", `-${total.removed}`)}`, safeWidth));
	rows.push("");

	if (files.length === 0) {
		rows.push(truncateToWidth(theme.fg("dim", "No write/edit changes recorded yet."), safeWidth));
		return rows;
	}

	const kindWidth = Math.max(3, ...files.map((file) => (file.kind === "modified" ? 3 : file.kind.length)));
	const plusWidth = Math.max(2, ...files.map((file) => String(file.added).length + 1));
	const minusWidth = Math.max(2, ...files.map((file) => String(file.removed).length + 1));
	const fixedWidth = kindWidth + plusWidth + minusWidth + 3;
	const fullRowPathWidth = safeWidth - fixedWidth;

	for (const file of files) {
		const kindLabel = file.kind === "modified" ? "mod" : file.kind;
		const kindColor = file.kind === "new" ? "success" : file.kind === "deleted" ? "error" : "dim";
		const pathColor = file.kind === "new" ? "success" : file.kind === "deleted" ? "error" : "text";
		const kind = theme.fg(kindColor, kindLabel.padEnd(kindWidth, " "));
		const plus = theme.fg("success", `+${String(file.added).padStart(plusWidth - 1, " ")}`);
		const minus = theme.fg("error", `-${String(file.removed).padStart(minusWidth - 1, " ")}`);

		if (fullRowPathWidth >= 8) {
			const filePath = theme.fg(pathColor, truncateToWidth(file.path, fullRowPathWidth));
			rows.push(truncateToWidth(`${kind} ${plus} ${minus} ${filePath}`, safeWidth));
			continue;
		}

		const summary = truncateToWidth(`${kindLabel} +${file.added} -${file.removed}`, safeWidth);
		const filePath = truncateToWidth(theme.fg(pathColor, file.path), safeWidth);
		rows.push(summary);
		rows.push(filePath);
	}

	return rows;
}

class ChangedFilesReportOverlay {
	private theme: Theme;
	private stats: Map<string, FileStats>;
	private done: () => void;

	constructor(theme: Theme, stats: Map<string, FileStats>, done: () => void) {
		this.theme = theme;
		this.stats = stats;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "ctrl+c")) {
			this.done();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const header = truncateToWidth(
			`${this.theme.fg("accent", "Session changed files")} ${this.theme.fg("dim", "(Esc to close)")}`,
			innerWidth,
		);
		const body = formatReport(this.theme, this.stats, innerWidth).map((line) => truncateToWidth(line, innerWidth));
		const lines = [header, "", ...body];
		const padded = lines.map((line) => line + " ".repeat(Math.max(0, innerWidth - visibleWidth(line))));
		return [
			this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`),
			...padded.map((line) => `${this.theme.fg("border", "│")}${line}${this.theme.fg("border", "│")}`),
			this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
		];
	}

	invalidate(): void {}
	dispose(): void {}
}

export default function sessionChangedFiles(pi: ExtensionAPI) {
	let fileStats = new Map<string, FileStats>();
	const pendingWrites = new Map<string, PendingWriteSnapshot>();

	const refreshUi = (ctx: ExtensionContext | null) => {
		if (!ctx || !ctx.hasUI) return;
		const total = totals(fileStats);
		ctx.ui.setStatus(
			STATUS_KEY,
			total.files === 0
				? ctx.ui.theme.fg("dim", "Changed: none")
				: `${ctx.ui.theme.fg("accent", `Changed: ${total.files}`)} ${ctx.ui.theme.fg("success", `+${total.added}`)} ${ctx.ui.theme.fg("error", `-${total.removed}`)}`,
		);
		ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => ({
			render: (width: number) => formatSummary(theme, fileStats, width),
			invalidate: () => {},
		}));
	};

	const reconstructState = (ctx: ExtensionContext) => {
		fileStats = new Map<string, FileStats>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === RESET_ENTRY_TYPE) {
				fileStats = new Map<string, FileStats>();
				continue;
			}
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message.role !== "toolResult") continue;
			if (message.toolName !== "edit" && message.toolName !== "write") continue;
			const details = message.details as PersistedToolDetails | undefined;
			const op = coerceOperationSummary(details?.sessionChangedFiles);
			if (op) applyOperation(fileStats, op);
		}
		refreshUi(ctx);
	};

	const recordOperation = (ctx: ExtensionContext, operation: OperationSummary) => {
		applyOperation(fileStats, operation);
		refreshUi(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		pendingWrites.clear();
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write") return;
		const input = event.input as { path?: string };
		if (typeof input.path !== "string") return;
		const absolutePath = toAbsolutePath(ctx.cwd, input.path);
		const existedBefore = fs.existsSync(absolutePath);
		const before = existedBefore ? fs.readFileSync(absolutePath, "utf8") : "";
		pendingWrites.set(event.toolCallId, {
			displayPath: toDisplayPath(ctx.cwd, absolutePath),
			before,
			existedBefore,
		});
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "edit") {
			if (event.isError) return;
			const input = event.input as { path?: string };
			if (typeof input.path !== "string") return;
			const details = (event.details ?? {}) as PersistedToolDetails;
			const diff = typeof details.diff === "string" ? details.diff : "";
			const counts = diff ? countDiffFromUnifiedDiff(diff) : { added: 0, removed: 0 };
			const operation: OperationSummary = {
				path: toDisplayPath(ctx.cwd, toAbsolutePath(ctx.cwd, input.path)),
				added: counts.added,
				removed: counts.removed,
				kind: "modified",
			};
			recordOperation(ctx, operation);
			return {
				details: {
					...details,
					sessionChangedFiles: operation,
				},
			};
		}

		if (event.toolName === "write") {
			const snapshot = pendingWrites.get(event.toolCallId);
			pendingWrites.delete(event.toolCallId);
			if (event.isError) return;
			const input = event.input as { content?: string };
			if (!snapshot || typeof input.content !== "string") return;
			const counts = countDiffBetweenContents(snapshot.before, input.content);
			const operation: OperationSummary = {
				path: snapshot.displayPath,
				added: counts.added,
				removed: counts.removed,
				kind: snapshot.existedBefore ? "modified" : "new",
			};
			recordOperation(ctx, operation);
			const details = (event.details ?? {}) as PersistedToolDetails;
			return {
				details: {
					...details,
					sessionChangedFiles: operation,
				},
			};
		}
	});

	pi.registerCommand("changed-files", {
		description: "Show files changed by write/edit tools in this session",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new ChangedFilesReportOverlay(theme, fileStats, done));
		},
	});

	pi.registerCommand("changed-files-reset", {
		description: "Reset changed-file tracking for the current session",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			fileStats = new Map<string, FileStats>();
			pendingWrites.clear();
			pi.appendEntry(RESET_ENTRY_TYPE, { timestamp: Date.now() });
			refreshUi(ctx);
			ctx.ui.notify("Changed-file tracking reset for this session", "info");
		},
	});

}
