import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Placement = "tab" | "split";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AgentSource = "bundled" | "global" | "project";
export type ChildStatus = "starting" | "working" | "blocked" | "settled" | "exited";
export type HerdrStatus = "idle" | "working" | "blocked" | "done" | "unknown";
export type ResultClassification = "success" | "incomplete" | "failure" | "interrupted";

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
  kind: "completion" | "blocked" | "interrupted" | "incomplete" | "failure" | "exited" | "closed";
  paneId: string;
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
