import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentCatalog, Placement, TrackedSubagent } from "./types.ts";

export interface LaunchInput {
  agent: string;
  task: string;
  name?: string;
  placement?: Placement;
  signal?: AbortSignal;
}

export interface SubagentController {
  getCatalog(): AgentCatalog;
  launch(input: LaunchInput, ctx: ExtensionContext): Promise<TrackedSubagent>;
  followup(paneId: string, message: string): Promise<unknown>;
  interrupt(paneId: string): Promise<unknown>;
  getResult(paneId: string): Promise<unknown>;
}

export interface ParsedSubagentCommand {
  agent: string;
  task: string;
  placement?: Placement;
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Unterminated quote in /subagent command");
  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

export function parseSubagentCommand(value: string): ParsedSubagentCommand | null {
  const tokens = tokenize(value);
  if (!tokens.length) return null;
  const agent = tokens.shift()!;
  let placement: Placement | undefined;
  let parsingOptions = true;
  const task: string[] = [];
  while (tokens.length) {
    const token = tokens.shift()!;
    if (parsingOptions && token === "--") {
      parsingOptions = false;
      continue;
    }
    if (parsingOptions && token === "--placement") {
      if (placement) throw new Error("Duplicate --placement option");
      const value = tokens.shift();
      if (value !== "tab" && value !== "split") throw new Error("--placement must be tab or split");
      placement = value;
      continue;
    }
    if (parsingOptions && token.startsWith("--")) throw new Error(`Unknown /subagent option: ${token}`);
    parsingOptions = false;
    task.push(token);
    task.push(...tokens);
    break;
  }
  if (!task.length) throw new Error("Usage: /subagent <agent> [--placement tab|split] <task>");
  return { agent, task: task.join(" "), ...(placement ? { placement } : {}) };
}

const MAX_RESULT_RETRIEVAL_BYTES = 50 * 1024;
const DEFAULT_RESULT_RETRIEVAL_BYTES = 16 * 1024;

function limitToolText(value: string, maximumBytes = MAX_RESULT_RETRIEVAL_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  const note = "\n[Result truncated; inspect the child session JSONL for the full response.]";
  const target = maximumBytes - Buffer.byteLength(note, "utf8");
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > target) break;
    output += character;
    bytes += size;
  }
  return output + note;
}

function toolResult(text: string, details: unknown = {}) {
  return { content: [{ type: "text" as const, text: limitToolText(text) }], details };
}

async function launchFromPicker(controller: SubagentController, ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Usage: /subagent <agent> [--placement tab|split] <task>", "warning");
    return;
  }
  const catalog = controller.getCatalog();
  if (!catalog.definitions.length) {
    ctx.ui.notify("No valid subagent definitions are available. Run the subagents_list tool for diagnostics.", "error");
    return;
  }
  const labels = catalog.definitions.map((definition) => `${definition.name} — ${definition.description}`);
  const selected = await ctx.ui.select("Select subagent", labels);
  if (!selected) return;
  const definition = catalog.definitions[labels.indexOf(selected)]!;
  const selectedPlacement = await ctx.ui.select("Placement", [definition.placement, definition.placement === "tab" ? "split" : "tab"]);
  if (!selectedPlacement) return;
  const task = await ctx.ui.editor(`Task for ${definition.name}`);
  if (!task?.trim()) return;
  const child = await controller.launch({ agent: definition.name, task, placement: selectedPlacement as Placement }, ctx);
  ctx.ui.notify(`Started ${child.label} in ${child.paneId}`, "info");
}

export function registerSubagentsUI(pi: ExtensionAPI, controller: SubagentController): void {
  pi.registerTool({
    name: "subagent",
    label: "Launch Subagent",
    description: "Launch a persistent interactive Pi child in a Herdr tab (default) or split. The call waits for startup and task submission, not completion. Children share the current checkout; avoid concurrent writers.",
    promptSnippet: "Launch a persistent Herdr-hosted Pi subagent",
    parameters: Type.Object({
      agent: Type.String({ description: "Resolved agent role name" }),
      task: Type.String({ description: "Initial task for the child" }),
      name: Type.Optional(Type.String({ description: "Human-facing Herdr label override" })),
      placement: Type.Optional(StringEnum(["tab", "split"] as const)),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (signal?.aborted) throw new Error("Subagent launch cancelled");
      const child = await controller.launch({ ...params, signal }, ctx);
      return toolResult(
        `Started ${child.label} in ${child.placement} ${child.paneId}. The child is running asynchronously and remains directly interactive.`,
        {
          paneId: child.paneId,
          tabId: child.tabId,
          label: child.label,
          agent: child.agentName,
          model: child.model,
          thinking: child.thinking,
          placement: child.placement,
          sessionPath: child.sessionPath,
        },
      );
    },
  });

  pi.registerTool({
    name: "subagent_followup",
    label: "Follow Up With Subagent",
    description: "Submit or FIFO-queue a follow-up for a child pane owned by this parent runtime. Blocked children may require direct pane interaction.",
    parameters: Type.Object({
      paneId: Type.String(),
      message: Type.String(),
    }),
    async execute(_id, params) {
      const result = await controller.followup(params.paneId, params.message);
      return toolResult(`Follow-up for ${params.paneId}: ${(result as { status?: string }).status ?? "accepted"}`, result);
    },
  });

  pi.registerTool({
    name: "subagent_interrupt",
    label: "Interrupt Subagent",
    description: "Send Escape to an actively working child pane owned by this parent runtime. The persistent Pi process and pane stay open.",
    parameters: Type.Object({ paneId: Type.String() }),
    async execute(_id, params) {
      const result = await controller.interrupt(params.paneId);
      return toolResult(`Interrupt ${params.paneId}: ${(result as { status?: string }).status ?? "requested"}`, result);
    },
  });

  pi.registerTool({
    name: "get_subagent_result",
    label: "Get Subagent Result",
    description: "Retrieve the latest completed response once, without waiting. Automatic handoffs are compact; use this only when their omitted detail is needed. A queued automatic handoff is cancelled to prevent duplicate delivery.",
    parameters: Type.Object({
      paneId: Type.String(),
      maxBytes: Type.Optional(Type.Integer({
        minimum: 1024,
        maximum: MAX_RESULT_RETRIEVAL_BYTES,
        description: `Maximum model-visible response bytes (default ${DEFAULT_RESULT_RETRIEVAL_BYTES})`,
      })),
    }),
    async execute(_id, params) {
      const value = await controller.getResult(params.paneId) as {
        status: string;
        result?: { text?: string; [key: string]: unknown };
        alreadyRetrieved?: boolean;
        entryId?: string;
      };
      if (value.alreadyRetrieved) {
        return toolResult(
          `Subagent ${params.paneId}: ${value.status}. Result ${value.entryId ?? ""} was already retrieved; not repeating it.`,
          value,
        );
      }
      const heading = `Subagent ${params.paneId}: ${value.status}`;
      const resultText = value.result?.text
        || (typeof value.result?.errorMessage === "string" ? value.result.errorMessage : "");
      const maximumBytes = params.maxBytes ?? DEFAULT_RESULT_RETRIEVAL_BYTES;
      const bodyBudget = Math.max(0, maximumBytes - Buffer.byteLength(`${heading}\n\nLatest completed result:\n`, "utf8"));
      const text = resultText
        ? `${heading}\n\nLatest completed result:\n${limitToolText(resultText, bodyBudget)}`
        : heading;
      const details = value.result
        ? { ...value, result: Object.fromEntries(Object.entries(value.result).filter(([key]) => key !== "text")) }
        : value;
      return toolResult(text, details);
    },
  });

  pi.registerTool({
    name: "subagents_list",
    label: "List Subagents",
    description: "List resolved Herdr subagent definitions and discovery diagnostics.",
    parameters: Type.Object({}),
    async execute() {
      const catalog = controller.getCatalog();
      const lines = catalog.definitions.map((definition) =>
        `${definition.name}: ${definition.description} [${definition.model}, ${definition.thinking}, ${definition.placement}; tools=${definition.tools.join(",") || "none"}] (${definition.source}: ${definition.sourcePath})`,
      );
      for (const item of catalog.diagnostics) lines.push(`diagnostic: ${item.path}: ${item.message}`);
      return toolResult(lines.length ? lines.join("\n") : "No subagent definitions found.", {
        definitions: catalog.definitions,
        diagnostics: catalog.diagnostics,
      });
    },
  });

  pi.registerCommand("subagent", {
    description: "Launch a persistent Herdr Pi subagent",
    getArgumentCompletions(prefix) {
      if (prefix.includes(" ")) return null;
      const items = controller.getCatalog().definitions
        .filter((definition) => definition.name.startsWith(prefix))
        .map((definition) => ({ value: definition.name, label: definition.name, description: definition.description }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      try {
        const parsed = parseSubagentCommand(args);
        if (!parsed) {
          await launchFromPicker(controller, ctx);
          return;
        }
        const child = await controller.launch(parsed, ctx);
        ctx.ui.notify(`Started ${child.label} in ${child.paneId}`, "info");
      } catch (error) {
        ctx.ui.notify(String(error instanceof Error ? error.message : error), "error");
      }
    },
  });
}
