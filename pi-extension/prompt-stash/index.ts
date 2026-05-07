import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "../lib/pi-coding-agent-compat.ts";
import { Container, matchesKey, Text, truncateToWidth, visibleWidth } from "../lib/pi-tui-compat.ts";

const ENTRY_TYPE = "prompt-stash";
const STATUS_KEY = "prompt-stash";

const COMMAND_STASH = "stash";
const COMMAND_POP = "stash-pop";
const COMMAND_PICK = "stash-pick";
const COMMAND_CLEAR = "stash-clear";

const SHORTCUT_STASH = "ctrl+alt+s";
const SHORTCUT_POP = "ctrl+alt+o";
const SHORTCUT_PICK = "ctrl+alt+k";

const PREVIEW_MAX = 72;
const PICKER_MAX_ROWS = 10;

type StashItem = {
	id: string;
	text: string;
	createdAt: number;
};

type StashEvent = { op: "push"; item: StashItem } | { op: "remove"; id: string } | { op: "clear" };

type PickerAction =
	| { action: "restore"; id: string }
	| { action: "preview"; id: string }
	| { action: "delete"; id: string }
	| { action: "cancel" };

function isStashItem(value: unknown): value is StashItem {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<StashItem>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.text === "string" &&
		typeof candidate.createdAt === "number" &&
		Number.isFinite(candidate.createdAt)
	);
}

function coerceStashEvent(value: unknown): StashEvent | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<StashEvent> & { item?: unknown; id?: unknown };

	if (candidate.op === "push" && isStashItem(candidate.item)) {
		return { op: "push", item: candidate.item };
	}
	if (candidate.op === "remove" && typeof candidate.id === "string") {
		return { op: "remove", id: candidate.id };
	}
	if (candidate.op === "clear") {
		return { op: "clear" };
	}
	return null;
}

function preview(text: string, max = PREVIEW_MAX): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, Math.max(0, max - 1))}…`;
}

function formatTimestamp(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	} catch {
		return "--:--";
	}
}

function formatPickerLabel(item: StashItem): string {
	return `[${formatTimestamp(item.createdAt)}] ${preview(item.text)}`;
}

function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

function refreshStatus(ctx: ExtensionContext, stash: StashItem[]): void {
	if (!ctx.hasUI) return;
	const theme = ctx.ui.theme;
	if (stash.length === 0) {
		ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "Stash: 0"));
		return;
	}
	ctx.ui.setStatus(
		STATUS_KEY,
		`${theme.fg("accent", `Stash: ${stash.length}`)} ${theme.fg("dim", stash.length === 1 ? "item" : "items")}`,
	);
}

function rebuildStash(ctx: ExtensionContext): StashItem[] {
	const next: StashItem[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const event = coerceStashEvent(entry.data);
		if (!event) continue;
		if (event.op === "push") {
			next.push(event.item);
			continue;
		}
		if (event.op === "remove") {
			const index = next.findIndex((item) => item.id === event.id);
			if (index >= 0) next.splice(index, 1);
			continue;
		}
		next.length = 0;
	}
	return next;
}

function getEditorText(ctx: ExtensionContext): string {
	return ctx.ui.getEditorText();
}

function appendToEditor(ctx: ExtensionContext, text: string): void {
	const current = getEditorText(ctx);
	if (current.length === 0) {
		ctx.ui.setEditorText(text);
		return;
	}
	ctx.ui.setEditorText(`${current}\n\n${text}`);
}

function persistEvent(pi: ExtensionAPI, event: StashEvent): void {
	pi.appendEntry(ENTRY_TYPE, event);
}

class StashPickerComponent {
	private selected = 0;
	private scrollTop = 0;

	constructor(
		private readonly theme: Theme,
		private readonly items: StashItem[],
		private readonly done: (result: PickerAction) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done({ action: "cancel" });
			return;
		}

		if (matchesKey(data, "up") || data === "k" || data === "K") {
			this.selected = Math.max(0, this.selected - 1);
			this.ensureSelectionVisible();
			return;
		}

		if (matchesKey(data, "down") || data === "j" || data === "J") {
			this.selected = Math.min(this.items.length - 1, this.selected + 1);
			this.ensureSelectionVisible();
			return;
		}

		const item = this.items[this.selected];
		if (!item) return;

		if (matchesKey(data, "return") || data === "o" || data === "O") {
			this.done({ action: "restore", id: item.id });
			return;
		}
		if (data === "p" || data === "P") {
			this.done({ action: "preview", id: item.id });
			return;
		}
		if (data === "d" || data === "D") {
			this.done({ action: "delete", id: item.id });
		}
	}

	render(width: number): string[] {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));
		container.addChild(new Text(this.theme.fg("accent", this.theme.bold(`Prompt Stash (${this.items.length})`)), 1, 0));
		container.addChild(
			new Text(this.theme.fg("dim", "↑↓/j k navigate • enter/o restore • p preview • d delete • esc cancel"), 1, 0),
		);
		container.addChild(new Text("", 0, 0));

		const visibleItems = this.items.slice(this.scrollTop, this.scrollTop + PICKER_MAX_ROWS);
		const availableWidth = Math.max(20, width - 4);
		for (let i = 0; i < visibleItems.length; i++) {
			const absoluteIndex = this.scrollTop + i;
			const item = visibleItems[i]!;
			const isSelected = absoluteIndex === this.selected;
			const prefix = isSelected ? this.theme.fg("accent", "▶ ") : this.theme.fg("dim", "  ");
			const body = truncateToWidth(formatPickerLabel(item), availableWidth);
			const line = `${prefix}${isSelected ? this.theme.fg("accent", body) : body}`;
			container.addChild(new Text(line, 1, 0));
		}

		if (this.items.length > PICKER_MAX_ROWS) {
			const start = this.scrollTop + 1;
			const end = Math.min(this.items.length, this.scrollTop + PICKER_MAX_ROWS);
			container.addChild(new Text(this.theme.fg("dim", `${start}-${end} of ${this.items.length}`), 1, 0));
		}

		const selectedItem = this.items[this.selected];
		if (selectedItem) {
			const previewWidth = Math.max(20, width - 6);
			container.addChild(new Text("", 0, 0));
			container.addChild(new Text(this.theme.fg("dim", "Selected preview:"), 1, 0));
			container.addChild(new Text(this.theme.fg("muted", truncateToWidth(preview(selectedItem.text, previewWidth), previewWidth)), 1, 0));
		}

		container.addChild(new DynamicBorder((s: string) => this.theme.fg("accent", s)));
		return container.render(width);
	}

	invalidate(): void {}

	private ensureSelectionVisible(): void {
		if (this.selected < this.scrollTop) {
			this.scrollTop = this.selected;
			return;
		}
		const maxVisibleIndex = this.scrollTop + PICKER_MAX_ROWS - 1;
		if (this.selected > maxVisibleIndex) {
			this.scrollTop = this.selected - PICKER_MAX_ROWS + 1;
		}
	}
}

export default function promptStash(pi: ExtensionAPI) {
	let stash: StashItem[] = [];

	const syncUi = (ctx: ExtensionContext) => {
		refreshStatus(ctx, stash);
	};

	const stashCurrent = (ctx: ExtensionContext) => {
		const text = getEditorText(ctx);
		if (isBlank(text)) {
			ctx.ui.notify("Editor is empty", "info");
			return;
		}

		const item: StashItem = {
			id: randomUUID(),
			text,
			createdAt: Date.now(),
		};
		stash.push(item);
		persistEvent(pi, { op: "push", item });
		ctx.ui.setEditorText("");
		syncUi(ctx);
		ctx.ui.notify(`Stashed prompt (${stash.length} saved)`, "info");
	};

	const removeById = (id: string): StashItem | null => {
		const index = stash.findIndex((item) => item.id === id);
		if (index < 0) return null;
		const [item] = stash.splice(index, 1);
		return item ?? null;
	};

	const restoreItem = (ctx: ExtensionContext, item: StashItem) => {
		appendToEditor(ctx, item.text);
		syncUi(ctx);
		ctx.ui.notify("Restored stashed prompt", "info");
	};

	const popLatest = (ctx: ExtensionContext) => {
		const item = stash.at(-1);
		if (!item) {
			ctx.ui.notify("No saved prompts", "info");
			return;
		}
		stash.pop();
		persistEvent(pi, { op: "remove", id: item.id });
		restoreItem(ctx, item);
	};

	const pickFromStash = async (ctx: ExtensionContext) => {
		if (stash.length === 0) {
			ctx.ui.notify("No saved prompts", "info");
			return;
		}

		while (stash.length > 0) {
			const items = [...stash].reverse();
			const result = await ctx.ui.custom<PickerAction>(
				(tui, theme, _kb, done) => new StashPickerComponent(theme, items, done),
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-center",
						offsetY: -4,
						width: "70%",
						maxHeight: "70%",
					},
				},
			);

			if (!result || result.action === "cancel") {
				return;
			}

			const item = stash.find((entry) => entry.id === result.id);
			if (!item) {
				ctx.ui.notify("Selected stash item no longer exists", "error");
				return;
			}

			if (result.action === "preview") {
				await ctx.ui.editor("Preview stashed prompt", item.text);
				continue;
			}

			if (result.action === "delete") {
				const removed = removeById(item.id);
				if (!removed) {
					ctx.ui.notify("Selected stash item no longer exists", "error");
					return;
				}
				persistEvent(pi, { op: "remove", id: removed.id });
				syncUi(ctx);
				ctx.ui.notify("Deleted stashed prompt", "info");
				if (stash.length === 0) return;
				continue;
			}

			const removed = removeById(item.id);
			if (!removed) {
				ctx.ui.notify("Selected stash item no longer exists", "error");
				return;
			}
			persistEvent(pi, { op: "remove", id: removed.id });
			restoreItem(ctx, removed);
			return;
		}

		ctx.ui.notify("No saved prompts", "info");
	};

	const clearStash = (ctx: ExtensionContext) => {
		if (stash.length === 0) {
			ctx.ui.notify("Stash is already empty", "info");
			return;
		}
		stash = [];
		persistEvent(pi, { op: "clear" });
		syncUi(ctx);
		ctx.ui.notify("Cleared stash", "info");
	};

	pi.on("session_start", async (_event, ctx) => {
		stash = rebuildStash(ctx);
		syncUi(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stash = [];
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.registerShortcut(SHORTCUT_STASH, {
		description: "Stash current editor prompt",
		handler: async (ctx) => stashCurrent(ctx),
	});

	pi.registerShortcut(SHORTCUT_POP, {
		description: "Pop latest stashed prompt into editor",
		handler: async (ctx) => popLatest(ctx),
	});

	pi.registerShortcut(SHORTCUT_PICK, {
		description: "Pick a stashed prompt to restore",
		handler: async (ctx) => pickFromStash(ctx),
	});

	pi.registerCommand(COMMAND_STASH, {
		description: "Stash current editor prompt and clear the editor",
		handler: async (_args, ctx) => stashCurrent(ctx),
	});

	pi.registerCommand(COMMAND_POP, {
		description: "Pop the latest stashed prompt into the editor",
		handler: async (_args, ctx) => popLatest(ctx),
	});

	pi.registerCommand(COMMAND_PICK, {
		description: "Choose a stashed prompt to restore into the editor",
		handler: async (_args, ctx) => pickFromStash(ctx),
	});

	pi.registerCommand(COMMAND_CLEAR, {
		description: "Clear all stashed prompts for this session",
		handler: async (_args, ctx) => clearStash(ctx),
	});
}
