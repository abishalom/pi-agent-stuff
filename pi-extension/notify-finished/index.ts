/**
 * Notify Finished
 *
 * Global pi extension that notifies when a prompt finishes running, but only
 * after a configurable threshold.
 *
 * Config precedence:
 * 1. Environment variables
 * 2. ~/.pi/agent/extensions/notify-finished.json
 * 3. Defaults in this file
 *
 * Environment variables:
 * - PI_NOTIFY_ENABLED=true|false
 * - PI_NOTIFY_THRESHOLD_SECONDS=60
 * - PI_NOTIFY_MODE=smart|desktop|terminal|both|off
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", "notify-finished.json");
const STATUS_KEY = "notify-finished";
const DEFAULT_TITLE = "Pi";

type NotifyMode = "smart" | "desktop" | "terminal" | "both" | "off";

interface NotifyConfig {
	enabled: boolean;
	thresholdSeconds: number;
	mode: NotifyMode;
}

const DEFAULT_CONFIG: NotifyConfig = {
	enabled: true,
	thresholdSeconds: 60,
	mode: "smart",
};

function isNotifyMode(value: string): value is NotifyMode {
	return value === "smart" || value === "desktop" || value === "terminal" || value === "both" || value === "off";
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

function parseThreshold(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value.trim(), 10);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return parsed;
}

function sanitizeConfig(input: Partial<NotifyConfig> | null | undefined): NotifyConfig {
	const thresholdSeconds =
		typeof input?.thresholdSeconds === "number" && Number.isFinite(input.thresholdSeconds) && input.thresholdSeconds >= 0
			? Math.floor(input.thresholdSeconds)
			: DEFAULT_CONFIG.thresholdSeconds;
	const mode = typeof input?.mode === "string" && isNotifyMode(input.mode) ? input.mode : DEFAULT_CONFIG.mode;
	const enabled = typeof input?.enabled === "boolean" ? input.enabled : DEFAULT_CONFIG.enabled;
	return { enabled, thresholdSeconds, mode };
}

function loadSavedConfig(): NotifyConfig {
	try {
		if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
		const raw = fs.readFileSync(CONFIG_PATH, "utf8");
		return sanitizeConfig(JSON.parse(raw) as Partial<NotifyConfig>);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function applyEnvOverrides(config: NotifyConfig): NotifyConfig {
	const enabled = parseBoolean(process.env.PI_NOTIFY_ENABLED);
	const thresholdSeconds = parseThreshold(process.env.PI_NOTIFY_THRESHOLD_SECONDS);
	const envMode = process.env.PI_NOTIFY_MODE?.trim().toLowerCase();
	const mode = envMode && isNotifyMode(envMode) ? envMode : undefined;

	return sanitizeConfig({
		...config,
		enabled: enabled ?? config.enabled,
		thresholdSeconds: thresholdSeconds ?? config.thresholdSeconds,
		mode: mode ?? config.mode,
	});
}

function getEffectiveConfig(): NotifyConfig {
	return applyEnvOverrides(loadSavedConfig());
}

function saveConfig(config: NotifyConfig): void {
	fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
	fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(sanitizeConfig(config), null, 2)}\n`, "utf8");
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (seconds === 0) return `${minutes}m`;
	return `${minutes}m ${seconds}s`;
}

function escapePowerShellSingleQuoted(value: string): string {
	return value.replace(/'/g, "''");
}

function windowsToastScript(title: string, body: string): string {
	const safeTitle = escapePowerShellSingleQuoted(title);
	const safeBody = escapePowerShellSingleQuoted(body);
	const type = "Windows.UI.Notifications";
	return [
		`[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime] > $null`,
		`$template = [${type}.ToastTemplateType]::ToastText02`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent($template)`,
		`$textNodes = $xml.GetElementsByTagName('text')`,
		`$textNodes.Item(0).AppendChild($xml.CreateTextNode('${safeTitle}')) > $null`,
		`$textNodes.Item(1).AppendChild($xml.CreateTextNode('${safeBody}')) > $null`,
		`$toast = [${type}.ToastNotification]::new($xml)`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${safeTitle}').Show($toast)`,
	].join("; ");
}

function notifyWindows(title: string, body: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], (error) => {
			resolve(!error);
		});
	});
}

function notifyOSC777(title: string, body: string): boolean {
	try {
		process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
		return true;
	} catch {
		return false;
	}
}

function notifyOSC99(title: string, body: string): boolean {
	try {
		process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
		process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
		return true;
	} catch {
		return false;
	}
}

function ringBell(): boolean {
	try {
		process.stdout.write("\x07");
		return true;
	} catch {
		return false;
	}
}

function isWindowsTerminal(): boolean {
	return Boolean(process.env.WT_SESSION);
}

function isKittyTerminal(): boolean {
	return Boolean(process.env.KITTY_WINDOW_ID);
}

async function sendDesktopNotification(title: string, body: string): Promise<boolean> {
	if (isWindowsTerminal()) {
		return notifyWindows(title, body);
	}
	return false;
}

function sendTerminalNotification(title: string, body: string): boolean {
	if (isKittyTerminal()) {
		return notifyOSC99(title, body);
	}
	return notifyOSC777(title, body);
}

function setBusyStatus(ctx: ExtensionContext, thresholdSeconds: number): void {
	const theme = ctx.ui.theme;
	ctx.ui.setStatus(STATUS_KEY, `${theme.fg("accent", "●")} ${theme.fg("dim", `Notify after ${thresholdSeconds}s`)}`);
}

function setReadyStatus(ctx: ExtensionContext, config: NotifyConfig): void {
	const theme = ctx.ui.theme;
	const modeText = config.enabled && config.mode !== "off" ? `${config.mode}, ${config.thresholdSeconds}s` : "disabled";
	ctx.ui.setStatus(STATUS_KEY, `${theme.fg("success", "✓")} ${theme.fg("dim", `Notify ${modeText}`)}`);
}

function applyReadyTitle(ctx: ExtensionContext): void {
	ctx.ui.setTitle(DEFAULT_TITLE);
}

function applyBusyTitle(ctx: ExtensionContext): void {
	ctx.ui.setTitle(`${DEFAULT_TITLE} • working`);
}

function summarizeConfig(config: NotifyConfig): string {
	const state = config.enabled && config.mode !== "off" ? "on" : "off";
	return `Notifications ${state} • mode=${config.mode} • threshold=${config.thresholdSeconds}s`;
}

async function promptForThreshold(ctx: ExtensionContext, current: number): Promise<number | null> {
	const value = await ctx.ui.input("Notification threshold", `Current: ${current}s\nEnter threshold in seconds:`);
	if (value == null) return null;
	const parsed = parseThreshold(value);
	if (parsed == null) {
		ctx.ui.notify("Threshold must be a non-negative integer", "error");
		return null;
	}
	return parsed;
}

async function openSettingsMenu(ctx: ExtensionContext, getConfig: () => NotifyConfig, setConfig: (config: NotifyConfig) => void) {
	while (true) {
		const config = getConfig();
		const choice = await ctx.ui.select("Notify settings", [
			`${config.enabled ? "Disable" : "Enable"} notifications`,
			`Set threshold (${config.thresholdSeconds}s)`,
			`Set mode (${config.mode})`,
			"Show current config",
			"Done",
		]);

		if (!choice || choice === "Done") return;

		if (choice.includes("Enable") || choice.includes("Disable")) {
			const next = sanitizeConfig({ ...config, enabled: !config.enabled });
			setConfig(next);
			ctx.ui.notify(summarizeConfig(next), "info");
			continue;
		}

		if (choice.startsWith("Set threshold")) {
			const threshold = await promptForThreshold(ctx, config.thresholdSeconds);
			if (threshold != null) {
				const next = sanitizeConfig({ ...config, thresholdSeconds: threshold });
				setConfig(next);
				ctx.ui.notify(summarizeConfig(next), "info");
			}
			continue;
		}

		if (choice.startsWith("Set mode")) {
			const modeChoice = await ctx.ui.select("Notification mode", ["smart", "desktop", "terminal", "both", "off"]);
			if (modeChoice && isNotifyMode(modeChoice)) {
				const next = sanitizeConfig({ ...config, mode: modeChoice });
				setConfig(next);
				ctx.ui.notify(summarizeConfig(next), "info");
			}
			continue;
		}

		ctx.ui.notify(summarizeConfig(config), "info");
	}
}

export default function notifyFinished(pi: ExtensionAPI) {
	let activeConfig = getEffectiveConfig();
	let currentStartTime: number | null = null;

	function refreshConfig() {
		activeConfig = getEffectiveConfig();
		return activeConfig;
	}

	function persistConfig(config: NotifyConfig) {
		saveConfig(config);
		activeConfig = getEffectiveConfig();
	}

	pi.on("session_start", async (_event, ctx) => {
		const config = refreshConfig();
		setReadyStatus(ctx, config);
		applyReadyTitle(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		const config = refreshConfig();
		currentStartTime = Date.now();
		setBusyStatus(ctx, config.thresholdSeconds);
		applyBusyTitle(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const config = refreshConfig();
		const startedAt = currentStartTime;
		currentStartTime = null;
		setReadyStatus(ctx, config);
		applyReadyTitle(ctx);

		if (!startedAt) return;
		if (!config.enabled || config.mode === "off") return;

		const elapsedMs = Date.now() - startedAt;
		if (elapsedMs < config.thresholdSeconds * 1000) return;

		const body = `Prompt finished in ${formatDuration(elapsedMs)}`;
		let notified = false;

		if (config.mode === "smart") {
			notified = (await sendDesktopNotification(DEFAULT_TITLE, body)) || sendTerminalNotification(DEFAULT_TITLE, body);
		} else if (config.mode === "desktop") {
			notified = await sendDesktopNotification(DEFAULT_TITLE, body);
		} else if (config.mode === "terminal") {
			notified = sendTerminalNotification(DEFAULT_TITLE, body);
		} else if (config.mode === "both") {
			const desktop = await sendDesktopNotification(DEFAULT_TITLE, body);
			const terminal = sendTerminalNotification(DEFAULT_TITLE, body);
			notified = desktop || terminal;
		}

		if (!notified) {
			ringBell();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		currentStartTime = null;
		setReadyStatus(ctx, refreshConfig());
		applyReadyTitle(ctx);
	});

	pi.registerCommand("notify-settings", {
		description: "Configure long-running prompt notifications",
		handler: async (_args, ctx) => {
			await openSettingsMenu(ctx, () => refreshConfig(), (config) => persistConfig(config));
			setReadyStatus(ctx, refreshConfig());
		},
	});

	pi.registerCommand("notify-on", {
		description: "Enable long-running prompt notifications",
		handler: async (_args, ctx) => {
			persistConfig({ ...loadSavedConfig(), enabled: true });
			setReadyStatus(ctx, refreshConfig());
			ctx.ui.notify(summarizeConfig(activeConfig), "success");
		},
	});

	pi.registerCommand("notify-off", {
		description: "Disable long-running prompt notifications",
		handler: async (_args, ctx) => {
			persistConfig({ ...loadSavedConfig(), enabled: false });
			setReadyStatus(ctx, refreshConfig());
			ctx.ui.notify(summarizeConfig(activeConfig), "success");
		},
	});

	pi.registerCommand("notify-threshold", {
		description: "Set notification threshold in seconds",
		handler: async (args, ctx) => {
			const threshold = parseThreshold(args.trim());
			if (threshold == null) {
				ctx.ui.notify("Usage: /notify-threshold <seconds>", "error");
				return;
			}
			persistConfig({ ...loadSavedConfig(), thresholdSeconds: threshold });
			setReadyStatus(ctx, refreshConfig());
			ctx.ui.notify(summarizeConfig(activeConfig), "success");
		},
	});

	pi.registerCommand("notify-mode", {
		description: "Set notification mode: smart, desktop, terminal, both, off",
		getArgumentCompletions: (prefix) => {
			const modes = ["smart", "desktop", "terminal", "both", "off"];
			const matches = modes.filter((mode) => mode.startsWith(prefix.trim().toLowerCase()));
			return matches.length > 0 ? matches.map((mode) => ({ value: mode, label: mode })) : null;
		},
		handler: async (args, ctx) => {
			const mode = args.trim().toLowerCase();
			if (!isNotifyMode(mode)) {
				ctx.ui.notify("Usage: /notify-mode <smart|desktop|terminal|both|off>", "error");
				return;
			}
			persistConfig({ ...loadSavedConfig(), mode });
			setReadyStatus(ctx, refreshConfig());
			ctx.ui.notify(summarizeConfig(activeConfig), "success");
		},
	});
}
