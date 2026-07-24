import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  HerdrClient,
  HerdrStatus,
  PaneInfo,
  PaneRect,
  SurfaceInfo,
} from "./types.ts";

const OUTPUT_LIMIT = 4096;
const SOURCE_ID = "pi-herdr-subagents";

interface HerdrEnvelope {
  id?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export class HerdrCommandError extends Error {
  readonly command: string;
  readonly codeName?: string;
  readonly exitCode: number;

  constructor(command: string, message: string, exitCode: number, codeName?: string) {
    super(message);
    this.name = "HerdrCommandError";
    this.command = command;
    this.exitCode = exitCode;
    this.codeName = codeName;
  }
}

function bounded(text: string): string {
  const value = text.trim();
  return value.length <= OUTPUT_LIMIT ? value : `${value.slice(0, OUTPUT_LIMIT)}…`;
}

function displayCommand(args: string[]): string {
  const shown = [...args];
  if (shown[0] === "agent" && shown[1] === "prompt" && shown.length > 3) shown[3] = "<message>";
  return bounded(`herdr ${shown.join(" ")}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function status(value: unknown): HerdrStatus {
  return value === "idle" || value === "working" || value === "blocked" || value === "done"
    ? value
    : "unknown";
}

function paneFromResult(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return record(result?.agent) ?? record(result?.pane) ?? record(result?.root_pane);
}

export function parsePaneInfo(value: unknown): PaneInfo {
  const pane = record(value);
  if (!pane) throw new Error("Herdr response did not contain a pane record");
  const paneId = text(pane.pane_id);
  const tabId = text(pane.tab_id);
  const workspaceId = text(pane.workspace_id);
  if (!paneId || !tabId || !workspaceId) throw new Error("Herdr pane record is missing pane_id, tab_id, or workspace_id");
  const session = record(pane.agent_session);
  return {
    paneId,
    tabId,
    workspaceId,
    status: status(pane.agent_status),
    stateChangeSeq: number(pane.state_change_seq),
    interactiveReady: typeof pane.interactive_ready === "boolean" ? pane.interactive_ready : undefined,
    sessionPath: text(session?.value),
    agent: text(pane.agent),
  };
}

export function chooseSplitDirection(
  rect: Pick<PaneRect, "width" | "height">,
  minimum = { width: 60, height: 16 },
): "right" | "down" | null {
  const rightFits = Math.floor(rect.width / 2) >= minimum.width;
  const downFits = Math.floor(rect.height / 2) >= minimum.height;
  if (rightFits && (!downFits || rect.width >= 2 * rect.height)) return "right";
  if (downFits) return "down";
  if (rightFits) return "right";
  return null;
}

export function controlNameFor(role: string, paneId: string): string {
  const cleanRole = role.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "subagent";
  const cleanPane = paneId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleanRole}-${cleanPane}`.slice(0, 63);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}

export class CliHerdrClient implements HerdrClient {
  private readonly pi: Pick<ExtensionAPI, "exec">;

  constructor(pi: Pick<ExtensionAPI, "exec">) {
    this.pi = pi;
  }

  private async run(args: string[], options: { signal?: AbortSignal; timeout?: number; json?: boolean } = {}): Promise<HerdrEnvelope | string> {
    const command = displayCommand(args);
    const result = await this.pi.exec("herdr", args, {
      signal: options.signal,
      ...(options.timeout ? { timeout: options.timeout } : {}),
    });
    let envelope: HerdrEnvelope | undefined;
    if (options.json !== false) {
      const candidates = result.code === 0
        ? [result.stdout]
        : [result.stdout, result.stderr];
      const parsed: HerdrEnvelope[] = [];
      for (const candidate of candidates) {
        if (!candidate.trim()) continue;
        try {
          const value = JSON.parse(candidate) as HerdrEnvelope;
          if (value && typeof value === "object") parsed.push(value);
        } catch {
          // A failed Herdr command may put human-readable output on one stream
          // and its structured error on the other. Check both before falling back.
        }
      }
      envelope = parsed.find((value) => value.error) ?? parsed[0];
      if (!envelope && result.code === 0 && result.stdout.trim()) {
        throw new HerdrCommandError(command, `malformed JSON: ${bounded(result.stdout)}`, result.code);
      }
    }
    if (result.code !== 0 || envelope?.error) {
      const codeName = envelope?.error?.code;
      const detail = envelope?.error?.message ?? (bounded(result.stderr || result.stdout) || `exit code ${result.code}`);
      throw new HerdrCommandError(command, `${command} failed: ${detail}`, result.code, codeName);
    }
    return options.json === false ? result.stdout : (envelope ?? {});
  }

  private result(envelope: HerdrEnvelope | string): Record<string, unknown> {
    if (typeof envelope === "string" || !envelope.result) throw new Error("Herdr response is missing result");
    return envelope.result;
  }

  async validate(signal?: AbortSignal): Promise<void> {
    await this.run(["--version"], { signal, timeout: 5000, json: false });
    const output = await this.run(["integration", "status"], { signal, timeout: 5000, json: false }) as string;
    if (!/^pi: current \([^)]+\)(?: \([^)]+\))?$/m.test(output)) {
      throw new Error("Herdr's Pi integration is missing or outdated. Run: herdr integration install pi");
    }
  }

  async currentPane(signal?: AbortSignal): Promise<PaneInfo> {
    const result = this.result(await this.run(["pane", "current", "--current"], { signal, timeout: 5000 }));
    return parsePaneInfo(paneFromResult(result));
  }

  async paneRect(paneId: string, signal?: AbortSignal): Promise<PaneRect> {
    const result = this.result(await this.run(["pane", "layout", "--pane", paneId], { signal, timeout: 5000 }));
    const layout = record(result.layout);
    const panes = Array.isArray(layout?.panes) ? layout.panes : [];
    const target = panes.map(record).find((pane) => text(pane?.pane_id) === paneId);
    const rect = record(target?.rect) ?? record(layout?.area);
    const width = number(rect?.width);
    const height = number(rect?.height);
    if (!width || !height) throw new Error(`Herdr layout did not contain geometry for ${paneId}`);
    return { width, height, x: number(rect?.x), y: number(rect?.y) };
  }

  async createTab(input: { workspaceId: string; cwd: string; label: string; env: Record<string, string> }, signal?: AbortSignal): Promise<SurfaceInfo> {
    const args = ["tab", "create", "--workspace", input.workspaceId, "--cwd", input.cwd, "--label", input.label];
    for (const [key, value] of Object.entries(input.env)) args.push("--env", `${key}=${value}`);
    args.push("--no-focus");
    const result = this.result(await this.run(args, { signal, timeout: 10000 }));
    const pane = parsePaneInfo(record(result.root_pane) ?? record(result.pane));
    return { paneId: pane.paneId, tabId: pane.tabId, workspaceId: pane.workspaceId, placement: "tab" };
  }

  async createSplit(input: { parentPaneId: string; direction: "right" | "down"; cwd: string; env: Record<string, string> }, signal?: AbortSignal): Promise<SurfaceInfo> {
    const args = ["pane", "split", "--pane", input.parentPaneId, "--direction", input.direction, "--cwd", input.cwd];
    for (const [key, value] of Object.entries(input.env)) args.push("--env", `${key}=${value}`);
    args.push("--no-focus");
    const result = this.result(await this.run(args, { signal, timeout: 10000 }));
    const pane = parsePaneInfo(paneFromResult(result));
    return { paneId: pane.paneId, tabId: pane.tabId, workspaceId: pane.workspaceId, placement: "split" };
  }

  async renamePane(paneId: string, label: string, signal?: AbortSignal): Promise<void> {
    await this.run(["pane", "rename", paneId, label], { signal, timeout: 5000 });
  }

  async renameTab(tabId: string, label: string, signal?: AbortSignal): Promise<void> {
    await this.run(["tab", "rename", tabId, label], { signal, timeout: 5000 });
  }

  async reportRole(paneId: string, role: string, signal?: AbortSignal): Promise<void> {
    await this.run([
      "pane", "report-metadata", paneId,
      "--source", SOURCE_ID,
      "--applies-to-source", "herdr:pi",
      "--token", `role=${role}`,
    ], { signal, timeout: 5000 });
  }

  async startPi(input: { paneId: string; controlName: string; args: string[]; timeoutMs: number }, signal?: AbortSignal): Promise<PaneInfo> {
    const deadline = Date.now() + input.timeoutMs;
    while (true) {
      try {
        const result = this.result(await this.run([
          "agent", "start", input.controlName,
          "--kind", "pi",
          "--pane", input.paneId,
          "--timeout", String(Math.max(1000, deadline - Date.now())),
          "--",
          ...input.args,
        ], { signal, timeout: Math.max(1500, deadline - Date.now() + 1000) }));
        return parsePaneInfo(paneFromResult(result));
      } catch (error) {
        if (!(error instanceof HerdrCommandError) || error.codeName !== "agent_pane_busy" || Date.now() >= deadline) throw error;
        await abortableDelay(100, signal);
      }
    }
  }

  async prompt(paneId: string, message: string, signal?: AbortSignal): Promise<PaneInfo> {
    const result = this.result(await this.run([
      "agent", "prompt", paneId, message,
      "--wait",
      "--until", "working",
      "--until", "blocked",
      "--until", "idle",
      "--until", "done",
      "--timeout", "10000",
    ], { signal, timeout: 12000 }));
    return parsePaneInfo(paneFromResult(result));
  }

  async getAgent(paneId: string, signal?: AbortSignal): Promise<PaneInfo | null> {
    try {
      const result = this.result(await this.run(["agent", "get", paneId], { signal, timeout: 5000 }));
      return parsePaneInfo(paneFromResult(result));
    } catch (error) {
      if (error instanceof HerdrCommandError && (error.codeName === "agent_not_found" || error.codeName === "agent_not_running")) return null;
      throw error;
    }
  }

  async getPane(paneId: string, signal?: AbortSignal): Promise<PaneInfo | null> {
    try {
      const result = this.result(await this.run(["pane", "get", paneId], { signal, timeout: 5000 }));
      return parsePaneInfo(paneFromResult(result));
    } catch (error) {
      if (error instanceof HerdrCommandError && (error.codeName === "pane_not_found" || error.codeName === "pane_closed")) return null;
      throw error;
    }
  }

  async waitAgent(paneId: string, statuses: HerdrStatus[], timeoutMs: number, signal?: AbortSignal): Promise<PaneInfo | null> {
    const args = ["agent", "wait", paneId];
    for (const wanted of statuses) args.push("--until", wanted);
    args.push("--timeout", String(timeoutMs));
    try {
      const result = this.result(await this.run(args, { signal, timeout: timeoutMs + 1000 }));
      return parsePaneInfo(paneFromResult(result));
    } catch (error) {
      if (error instanceof HerdrCommandError && ["agent_wait_timeout", "timeout"].includes(error.codeName ?? "")) return null;
      throw error;
    }
  }

  async sendEscape(paneId: string, signal?: AbortSignal): Promise<void> {
    await this.run(["agent", "send-keys", paneId, "escape"], { signal, timeout: 5000 });
  }
}
