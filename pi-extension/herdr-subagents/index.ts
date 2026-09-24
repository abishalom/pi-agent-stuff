import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadAgentCatalog } from "./agents.ts";
import {
  DELIVERY_CUSTOM_TYPE,
  DeliveryScheduler,
  pruneDigestedDeliveryMessages,
  renderDeliveryMessage,
} from "./delivery.ts";
import { chooseSplitDirection, CliHerdrClient, controlNameFor } from "./herdr.ts";
import { SubagentMonitorManager } from "./monitor.ts";
import { SessionReaderStore } from "./session-reader.ts";
import { isThinkingLevel, parseModelSpec } from "./types.ts";
import type {
  AgentCatalog,
  HerdrClient,
  Placement,
  ThinkingLevel,
  TrackedSubagent,
} from "./types.ts";
import { registerSubagentsUI, type LaunchInput, type SubagentController } from "./ui.ts";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATION_TOOLS = ["subagent", "subagent_followup", "subagent_interrupt", "get_subagent_result", "subagents_list"];
const MAX_DEPTH = 2;
const EMPTY_CATALOG: AgentCatalog = {
  definitions: [],
  diagnostics: [],
  get() { return undefined; },
};

export interface HerdrSubagentsOptions {
  clientFactory?: (pi: ExtensionAPI) => HerdrClient;
  bundledDir?: string;
  policyPath?: string;
  globalAgentsDir?: string;
  debounceMs?: number;
  env?: NodeJS.ProcessEnv;
}

function safeLabel(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function taskTitle(task: string): string {
  const compact = task.replace(/[`*_#>[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return "Task";
  const words = compact.split(" ").slice(0, 6).join(" ");
  return words.length > 42 ? `${words.slice(0, 41)}…` : words;
}

function roleLabel(role: string, task: string): string {
  const names: Record<string, [string, string]> = {
    explorer: ["E", "Explorer"],
    planner: ["P", "Planner"],
    worker: ["W", "Worker"],
    reviewer: ["R", "Reviewer"],
  };
  const [icon, name] = names[role] ?? [role.slice(0, 1).toUpperCase() || "S", role];
  return `[${icon}] ${name}: ${taskTitle(task)}`;
}

export class HerdrSubagentsRuntime implements SubagentController {
  private readonly pi: ExtensionAPI;
  private readonly client: HerdrClient;
  private readonly options: HerdrSubagentsOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly readers = new SessionReaderStore();
  private readonly delivery: DeliveryScheduler;
  private readonly monitor: SubagentMonitorManager;
  private readonly reservedLabels = new Set<string>();
  private readonly runtimeAbort = new AbortController();
  private catalog: AgentCatalog = EMPTY_CATALOG;
  private readonly depth: number;
  private readonly role?: string;
  private parentPaneId?: string;
  private parentWorkspaceId?: string;
  private validation?: Promise<void>;
  private generation = 1;
  private closed = false;

  constructor(pi: ExtensionAPI, options: HerdrSubagentsOptions = {}) {
    this.pi = pi;
    this.options = options;
    this.env = options.env ?? process.env;
    this.role = this.env.PI_HERDR_SUBAGENT === "1" ? this.env.PI_HERDR_AGENT : undefined;
    this.depth = this.env.PI_HERDR_SUBAGENT === "1" ? Number(this.env.PI_HERDR_DEPTH) : 0;
    this.client = options.clientFactory?.(pi) ?? new CliHerdrClient(pi);
    this.delivery = new DeliveryScheduler(pi, options.debounceMs ?? 500);
    this.monitor = new SubagentMonitorManager(this.client, this.delivery, this.readers);
  }

  startSession(ctx: ExtensionContext): void {
    this.closed = false;
    this.delivery.setContext(ctx);
    this.catalog = loadAgentCatalog({
      cwd: ctx.cwd,
      trusted: ctx.isProjectTrusted(),
      bundledDir: this.options.bundledDir ?? join(EXTENSION_DIR, "agents"),
      policyPath: this.options.policyPath ?? join(EXTENSION_DIR, "../../config/subagent-model-overrides.json"),
      parentThinking: this.pi.getThinkingLevel() as ThinkingLevel,
      availableTools: this.pi.getAllTools().map((tool) => tool.name),
      ...(this.options.globalAgentsDir ? { globalAgentsDir: this.options.globalAgentsDir } : {}),
    });
  }

  getCatalog(): AgentCatalog {
    if (!this.role) return this.catalog;
    const allowed = new Set(this.catalog.get(this.role)?.delegates ?? []);
    const definitions = this.catalog.definitions.filter((item) => allowed.has(item.name));
    return { ...this.catalog, definitions, get: (name) => definitions.find((item) => item.name === name.trim().toLowerCase()) };
  }

  private async validateEnvironment(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    if (ctx.mode !== "tui") throw new Error("Herdr subagents are available only in Pi's interactive TUI mode");
    if (this.env.HERDR_ENV !== "1") throw new Error("Herdr subagents require Pi to run inside Herdr (HERDR_ENV=1)");
    const expectedPane = this.env.HERDR_PANE_ID;
    if (!expectedPane) throw new Error("Herdr did not provide HERDR_PANE_ID to the parent Pi process");
    if (!this.validation) {
      this.validation = (async () => {
        await this.client.validate(signal);
        const current = await this.client.currentPane(signal);
        if (current.paneId !== expectedPane) {
          throw new Error(`Herdr parent pane mismatch: environment=${expectedPane}, current=${current.paneId}`);
        }
        this.parentPaneId = current.paneId;
        this.parentWorkspaceId = current.workspaceId;
      })().catch((error) => {
        this.validation = undefined;
        throw error;
      });
    }
    await this.validation;
  }

  private async validateModel(spec: string, ctx: ExtensionContext) {
    const parts = parseModelSpec(spec);
    if (!parts) throw new Error(`Invalid subagent model ${spec}; expected provider/model`);
    const model = ctx.modelRegistry.find(parts.provider, parts.id);
    if (!model) throw new Error(`Subagent model is not configured: ${spec}`);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(`Subagent model credentials are unavailable for ${spec}: ${auth.error}`);
    return model;
  }

  private uniqueLabel(base: string): string {
    const labels = new Set([...this.monitor.list().map((child) => child.label), ...this.reservedLabels]);
    if (!labels.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base} (${suffix})`;
      if (!labels.has(candidate)) return candidate;
    }
  }

  async launch(input: LaunchInput, ctx: ExtensionContext): Promise<TrackedSubagent> {
    if (this.closed) throw new Error("This parent subagent runtime has shut down");
    this.delivery.setContext(ctx);
    if (!Number.isInteger(this.depth) || this.depth < 0 || this.depth >= MAX_DEPTH) {
      throw new Error(`Subagent depth limit reached (maximum ${MAX_DEPTH})`);
    }
    if (this.env.PI_HERDR_SUBAGENT === "1") {
      const allowed = (this.role && this.catalog.get(this.role)?.delegates) || [];
      if (!allowed.includes(input.agent.trim().toLowerCase())) {
        throw new Error(`Role ${this.role ?? "unknown"} cannot delegate to ${input.agent}`);
      }
    }
    const signal = input.signal
      ? AbortSignal.any([this.runtimeAbort.signal, input.signal])
      : this.runtimeAbort.signal;
    await this.validateEnvironment(ctx, signal);
    const definition = this.catalog.get(input.agent);
    if (!definition) {
      const known = this.catalog.definitions.map((item) => item.name).join(", ") || "none";
      throw new Error(`Unknown or invalid subagent role ${input.agent}. Available: ${known}`);
    }
    if (!input.task.trim()) throw new Error("Subagent task must not be empty");
    const model = input.model ?? definition.model;
    const thinking = input.thinking ?? definition.thinking;
    if (!isThinkingLevel(thinking)) throw new Error(`Invalid subagent thinking level: ${thinking}`);
    const selectedModel = await this.validateModel(model, ctx);
    const effectiveThinking = clampThinkingLevel(selectedModel, thinking);

    const placement: Placement = input.placement ?? definition.placement ?? "tab";
    const label = this.uniqueLabel(safeLabel(input.name ?? roleLabel(definition.name, input.task)));
    if (!label) throw new Error("Subagent label must not be empty");
    this.reservedLabels.add(label);
    const parentPaneId = this.parentPaneId!;
    const parentWorkspaceId = this.parentWorkspaceId!;
    let surface: Awaited<ReturnType<HerdrClient["createTab"]>> | undefined;
    let promptDir: string | undefined;
    const childEnv = {
      PI_HERDR_SUBAGENT: "1",
      PI_HERDR_AGENT: definition.name,
      PI_HERDR_DEPTH: String(this.depth + 1),
      PI_HERDR_DELEGATES: definition.delegates.length && this.depth + 1 < MAX_DEPTH ? "1" : "0",
    };
    const tools = childEnv.PI_HERDR_DELEGATES === "1"
      ? [...new Set([...definition.tools, ...ORCHESTRATION_TOOLS])]
      : definition.tools;

    try {
      if (placement === "split") {
        const rect = await this.client.paneRect(parentPaneId, signal);
        const direction = chooseSplitDirection(rect);
        if (!direction) throw new Error("The parent pane is too small for a usable split; launch this child in a tab instead");
        surface = await this.client.createSplit({
          parentPaneId,
          direction,
          cwd: ctx.cwd,
          env: childEnv,
        }, signal);
      } else {
        surface = await this.client.createTab({
          workspaceId: parentWorkspaceId,
          cwd: ctx.cwd,
          label,
          env: childEnv,
        }, signal);
      }

      if (surface.paneId === parentPaneId) {
        throw new Error("Herdr returned the parent pane as the child surface; refusing to control it");
      }
      await this.client.renamePane(surface.paneId, label, signal);
      if (placement === "tab") await this.client.renameTab(surface.tabId, label, signal);
      try {
        await this.client.reportRole(surface.paneId, definition.name, signal);
      } catch (error) {
        ctx.ui.notify(`Subagent started without Herdr role metadata: ${String(error)}`, "warning");
      }

      promptDir = await mkdtemp(join(tmpdir(), "pi-herdr-subagent-"));
      await chmod(promptDir, 0o700);
      const promptPath = join(promptDir, "role.md");
      await writeFile(promptPath, `${definition.body}\n`, { mode: 0o600 });
      const args = [
        "--model", model,
        "--thinking", effectiveThinking,
        "--tools", tools.join(","),
        "--append-system-prompt", promptPath,
      ];
      const started = await this.client.startPi({
        paneId: surface.paneId,
        controlName: controlNameFor(definition.name, surface.paneId),
        args,
        timeoutMs: 30000,
      }, signal);
      const sessionPath = started.sessionPath;
      if (!sessionPath) throw new Error("Herdr started Pi but did not report its session JSONL path");
      await this.readers.get(sessionPath).baseline();
      const prompted = await this.client.prompt(surface.paneId, input.task, signal);

      const child: TrackedSubagent = {
        paneId: surface.paneId,
        tabId: surface.tabId,
        workspaceId: surface.workspaceId,
        agentName: definition.name,
        agentSourcePath: definition.sourcePath,
        label,
        placement,
        model,
        thinking: effectiveThinking,
        tools,
        sessionPath: prompted.sessionPath ?? sessionPath,
        status: prompted.status === "blocked" ? "blocked" : "working",
        queuedFollowups: [],
        resultDeliveryStates: new Map(),
        stateChangeSeq: prompted.stateChangeSeq,
        startedAt: Date.now(),
        turnStartedAt: Date.now(),
        monitorAbort: new AbortController(),
        generation: this.generation,
      };
      this.monitor.track(child);
      return child;
    } catch (error) {
      const location = surface ? ` Child surface remains open at ${surface.paneId}.` : "";
      throw new Error(`${error instanceof Error ? error.message : String(error)}${location}`);
    } finally {
      this.reservedLabels.delete(label);
      if (promptDir) await rm(promptDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  followup(paneId: string, message: string): Promise<unknown> {
    return this.monitor.followup(paneId, message);
  }

  interrupt(paneId: string): Promise<unknown> {
    return this.monitor.interrupt(paneId);
  }

  getResult(paneId: string): Promise<unknown> {
    return this.monitor.getResult(paneId);
  }

  parentSettled(ctx: ExtensionContext): void {
    this.delivery.parentSettled(ctx);
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.runtimeAbort.abort();
    this.reservedLabels.clear();
    this.monitor.shutdown();
    this.delivery.shutdown();
  }
}

export function createHerdrSubagentsExtension(options: HerdrSubagentsOptions = {}) {
  return function herdrSubagentsExtension(pi: ExtensionAPI): void {
    const env = options.env ?? process.env;
    const child = env.PI_HERDR_SUBAGENT === "1";
    const depth = Number(env.PI_HERDR_DEPTH);
    const canDelegate = !child || (env.PI_HERDR_DELEGATES === "1" && Number.isInteger(depth) && depth > 0 && depth < MAX_DEPTH);

    const runtime = new HerdrSubagentsRuntime(pi, options);
    pi.registerMessageRenderer(DELIVERY_CUSTOM_TYPE, renderDeliveryMessage);
    if (canDelegate) registerSubagentsUI(pi, runtime);
    pi.on("session_start", (_event, ctx) => runtime.startSession(ctx));
    pi.on("context", (event) => ({ messages: pruneDigestedDeliveryMessages(event.messages) }));
    pi.on("agent_settled", (_event, ctx) => runtime.parentSettled(ctx));
    pi.on("session_shutdown", () => runtime.shutdown());
  };
}

export default createHerdrSubagentsExtension();
