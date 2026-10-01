import type { ContextUsage, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Placement = "tab" | "split";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.some((level) => level === value);
}

export function parseModelSpec(value: unknown): { provider: string; id: string } | null {
  if (typeof value !== "string") return null;
  const match = /^([^/\s]+)\/([^/\s]+(?:\/[^/\s]+)*)$/.exec(value);
  return match ? { provider: match[1]!, id: match[2]! } : null;
}

export type AgentSource = "bundled" | "global" | "project";
export type ChildStatus = "starting" | "working" | "blocked" | "settled" | "exited";
export type HerdrStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type ResultClassification = "success" | "incomplete" | "failure" | "interrupted";
export type ResultDeliveryState = "queued" | "delivered" | "retrieved";

export interface AgentDiagnostic {
  source: AgentSource;
  path: string;
  message: string;
  name?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  thinking: ThinkingLevel;
  placement: Placement;
  tools: string[];
  delegates: string[];
  body: string;
  source: AgentSource;
  sourcePath: string;
}

export interface AgentCatalog {
  definitions: AgentDefinition[];
  diagnostics: AgentDiagnostic[];
  get(name: string): AgentDefinition | undefined;
}

export interface PaneInfo {
  paneId: string;
  tabId: string;
  workspaceId: string;
  status: HerdrStatus;
  stateChangeSeq?: number;
  interactiveReady?: boolean;
  sessionPath?: string;
  agent?: string;
}

export interface SurfaceInfo {
  paneId: string;
  tabId: string;
  workspaceId: string;
  placement: Placement;
}

export interface PaneRect {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export const CONTEXT_CUSTOM_TYPE = "herdr-subagent-context";
export const COMPACTION_CUSTOM_TYPE = "herdr-subagent-compaction";

/** Terminal Pi hook outcome; not an assistant response or a completion barrier. */
export interface ChildCompactionOutcome {
  timestamp: string;
  outcome: "success" | "failure" | "aborted";
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  fromExtension: boolean;
  errorMessage?: string;
}

export interface ChildCompactionEvent extends ChildCompactionOutcome {
  entryId: string;
}

/** Child-reported estimate, never a live parent-side measurement. */
export interface ChildContextSnapshot {
  timestamp: string;
  reason: "session_start" | "agent_settled" | "session_compact" | "model_select" | "session_tree";
  tokens: ContextUsage["tokens"];
  contextWindow: ContextUsage["contextWindow"] | null;
  percent: ContextUsage["percent"];
  model: string | null;
}

export interface SubagentStatus {
  paneId: string;
  status: HerdrStatus | "exited";
  contextSource: "last-reported";
  context: ChildContextSnapshot | null;
}

export interface CompactionRequest {
  paneId: string;
  requested: true;
}

export interface HerdrClient {
  validate(signal?: AbortSignal): Promise<void>;
  currentPane(signal?: AbortSignal): Promise<PaneInfo>;
  paneRect(paneId: string, signal?: AbortSignal): Promise<PaneRect>;
  createTab(input: {
    workspaceId: string;
    cwd: string;
    label: string;
    env: Record<string, string>;
  }, signal?: AbortSignal): Promise<SurfaceInfo>;
  createSplit(input: {
    parentPaneId: string;
    direction: "right" | "down";
    cwd: string;
    env: Record<string, string>;
  }, signal?: AbortSignal): Promise<SurfaceInfo>;
  renamePane(paneId: string, label: string, signal?: AbortSignal): Promise<void>;
  renameTab(tabId: string, label: string, signal?: AbortSignal): Promise<void>;
  reportRole(paneId: string, role: string, signal?: AbortSignal): Promise<void>;
  startPi(input: {
    paneId: string;
    controlName: string;
    args: string[];
    timeoutMs: number;
  }, signal?: AbortSignal): Promise<PaneInfo>;
  prompt(paneId: string, message: string, signal?: AbortSignal): Promise<PaneInfo>;
  requestCompaction(paneId: string, instructions?: string, signal?: AbortSignal): Promise<void>;
  getAgent(paneId: string, signal?: AbortSignal): Promise<PaneInfo | null>;
  getPane(paneId: string, signal?: AbortSignal): Promise<PaneInfo | null>;
  waitAgent(paneId: string, statuses: HerdrStatus[], timeoutMs: number, signal?: AbortSignal): Promise<PaneInfo | null>;
  sendEscape(paneId: string, signal?: AbortSignal): Promise<void>;
}

export interface ChildResult {
  entryId: string;
  text: string;
  classification: ResultClassification;
  stopReason: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
  sessionPath: string;
}

export interface DeliveryEvent {
  kind: "completion" | "blocked" | "interrupted" | "incomplete" | "failure" | "exited" | "closed" | "compaction_success" | "compaction_failure";
  compactionEntryId?: string;
  compaction?: ChildCompactionOutcome;
  paneId: string;
  entryId?: string;
  label: string;
  agentName: string;
  model: string;
  elapsedMs: number;
  text?: string;
  classification?: ResultClassification;
  sessionPath?: string;
  errorMessage?: string;
}

export interface TrackedSubagent {
  paneId: string;
  tabId: string;
  workspaceId: string;
  agentName: string;
  agentSourcePath: string;
  label: string;
  placement: Placement;
  model: string;
  thinking: ThinkingLevel;
  tools: string[];
  sessionPath?: string;
  status: ChildStatus;
  queuedFollowups: string[];
  lastObservedEntryId?: string;
  lastDeliveredEntryId?: string;
  lastRetrievedEntryId?: string;
  resultDeliveryStates: Map<string, ResultDeliveryState>;
  interruptEpisodeSeq?: number;
  interruptBaselineMessageIndex?: number;
  stateChangeSeq?: number;
  lastDrainedSettlementSeq?: number;
  fastSettledFollowupPending?: boolean;
  startedAt: number;
  turnStartedAt?: number;
  blockedEpisodeSeq?: number;
  latestResult?: ChildResult;
  monitorAbort: AbortController;
  generation: number;
}

export interface RuntimeContext {
  ctx: ExtensionContext;
  generation: number;
}
