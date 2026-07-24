import type { DeliveryScheduler } from "./delivery.ts";
import { SessionReaderStore } from "./session-reader.ts";
import type {
  ChildResult,
  DeliveryEvent,
  HerdrClient,
  HerdrStatus,
  PaneInfo,
  TrackedSubagent,
} from "./types.ts";

function isSettled(status: HerdrStatus): boolean {
  return status === "idle" || status === "done";
}

function resultKind(result: ChildResult): DeliveryEvent["kind"] {
  if (result.classification === "success") return "completion";
  if (result.classification === "interrupted") return "interrupted";
  if (result.classification === "incomplete") return "incomplete";
  return "failure";
}

export class SubagentMonitorManager {
  private readonly client: HerdrClient;
  private readonly readers: SessionReaderStore;
  private readonly delivery: DeliveryScheduler;
  private readonly children = new Map<string, TrackedSubagent>();
  private readonly monitorErrors = new Map<string, string>();
  private closed = false;

  constructor(client: HerdrClient, delivery: DeliveryScheduler, readers = new SessionReaderStore()) {
    this.client = client;
    this.delivery = delivery;
    this.readers = readers;
  }

  list(): TrackedSubagent[] {
    return [...this.children.values()];
  }

  getOwned(paneId: string): TrackedSubagent | undefined {
    return this.children.get(paneId);
  }

  requireOwned(paneId: string): TrackedSubagent {
    const child = this.children.get(paneId);
    if (!child) throw new Error(`Pane ${paneId} is not a child owned by this parent runtime`);
    return child;
  }

  track(child: TrackedSubagent): void {
    if (this.closed) throw new Error("Subagent runtime is closed");
    if (this.children.has(child.paneId)) throw new Error(`Pane ${child.paneId} is already tracked`);
    this.children.set(child.paneId, child);
    void this.monitorLoop(child);
  }

  private event(child: TrackedSubagent, kind: DeliveryEvent["kind"], extra: Partial<DeliveryEvent> = {}): DeliveryEvent {
    return {
      kind,
      paneId: child.paneId,
      label: child.label,
      agentName: child.agentName,
      model: child.model,
      elapsedMs: Date.now() - (child.turnStartedAt ?? child.startedAt),
      sessionPath: child.sessionPath,
      ...extra,
    };
  }

  private clearInterrupt(child: TrackedSubagent): void {
    child.interruptEpisodeSeq = undefined;
    child.interruptBaselineMessageIndex = undefined;
  }

  private async setSessionPath(child: TrackedSubagent, sessionPath: string): Promise<void> {
    if (child.sessionPath === sessionPath) return;
    child.sessionPath = sessionPath;
    await this.readers.get(sessionPath).baseline();
    child.latestResult = undefined;
    child.lastObservedEntryId = undefined;
    child.lastDeliveredEntryId = undefined;
    this.clearInterrupt(child);
  }

  private async scanResults(child: TrackedSubagent): Promise<number> {
    if (!child.sessionPath) return 0;
    const results = await this.readers.get(child.sessionPath).scanUnseen(
      child.interruptEpisodeSeq !== undefined,
      child.interruptBaselineMessageIndex,
    );
    for (const result of results) {
      child.latestResult = result;
      child.lastObservedEntryId = result.entryId;
      child.lastDeliveredEntryId = result.entryId;
      this.delivery.enqueue(this.event(child, resultKind(result), {
        text: result.text,
        classification: result.classification,
        sessionPath: result.sessionPath,
        errorMessage: result.errorMessage,
      }));
    }
    return results.length;
  }

  private async reconcile(child: TrackedSubagent): Promise<PaneInfo | null> {
    const signal = child.monitorAbort.signal;
    const agent = await this.client.getAgent(child.paneId, signal);
    if (!agent) {
      const pane = await this.client.getPane(child.paneId, signal);
      if (pane?.sessionPath) await this.setSessionPath(child, pane.sessionPath);
      const finalResults = await this.scanResults(child);
      const pending = child.status === "starting" || child.status === "working" || child.status === "blocked";
      child.status = "exited";
      this.clearInterrupt(child);
      if (finalResults === 0 && pane) {
        if (pending) this.delivery.enqueue(this.event(child, "exited", { errorMessage: "Child Pi exited before the active turn completed." }));
      } else if (finalResults === 0 && pending) {
        this.delivery.enqueue(this.event(child, "closed", { errorMessage: "Child pane closed before the active turn completed." }));
      }
      child.monitorAbort.abort();
      return null;
    }

    if (agent.sessionPath) await this.setSessionPath(child, agent.sessionPath);
    if (child.interruptEpisodeSeq !== undefined && agent.status === "working"
      && agent.stateChangeSeq !== undefined && agent.stateChangeSeq !== child.interruptEpisodeSeq) {
      this.clearInterrupt(child);
    }
    await this.scanResults(child);

    const previous = child.status;
    child.stateChangeSeq = agent.stateChangeSeq;
    if (agent.status === "working") {
      if (previous !== "working") child.turnStartedAt = Date.now();
      child.status = "working";
    } else if (agent.status === "blocked") {
      child.status = "blocked";
      const episode = agent.stateChangeSeq ?? (previous === "blocked" ? child.blockedEpisodeSeq : Date.now());
      if (child.blockedEpisodeSeq !== episode) {
        child.blockedEpisodeSeq = episode;
        this.delivery.enqueue(this.event(child, "blocked"));
      }
    } else if (isSettled(agent.status)) {
      child.status = "settled";
      child.turnStartedAt = undefined;
      this.clearInterrupt(child);
      const undrainedEpisode = child.fastSettledFollowupPending
        || (agent.stateChangeSeq !== undefined && child.lastDrainedSettlementSeq !== agent.stateChangeSeq);
      child.fastSettledFollowupPending = false;
      if (child.queuedFollowups.length
        && (previous === "working" || previous === "blocked" || previous === "starting" || undrainedEpisode)) {
        await this.drainOneFollowup(child, agent.stateChangeSeq);
      }
    }
    return agent;
  }

  private waitStatuses(child: TrackedSubagent): HerdrStatus[] {
    if (child.fastSettledFollowupPending) return ["idle", "done", "working", "blocked"];
    if (child.status === "working" || child.status === "starting") return ["idle", "done", "blocked"];
    if (child.status === "blocked") return ["working", "idle", "done"];
    return ["working", "blocked"];
  }

  private async monitorLoop(child: TrackedSubagent): Promise<void> {
    const signal = child.monitorAbort.signal;
    while (!this.closed && !signal.aborted) {
      try {
        await this.reconcile(child);
        this.monitorErrors.delete(child.paneId);
      } catch (error) {
        if (signal.aborted || this.closed) break;
        const message = String(error);
        if (this.monitorErrors.get(child.paneId) !== message) {
          this.monitorErrors.set(child.paneId, message);
          this.delivery.enqueue(this.event(child, "failure", { errorMessage: `Child monitor reconciliation failed: ${message}` }));
        }
      }
      if (signal.aborted || this.closed) break;
      try {
        await this.client.waitAgent(child.paneId, this.waitStatuses(child), 2000, signal);
      } catch (error) {
        if (signal.aborted || this.closed) break;
        // The next iteration always performs an unconditional get + JSONL reconciliation.
      }
    }
  }

  private async drainOneFollowup(child: TrackedSubagent, settlementSeq?: number): Promise<void> {
    if (!child.queuedFollowups.length || child.status !== "settled") return;
    const current = await this.client.getAgent(child.paneId, child.monitorAbort.signal);
    if (!current || !isSettled(current.status)) return;
    child.lastDrainedSettlementSeq = current.stateChangeSeq ?? settlementSeq;
    const message = child.queuedFollowups.shift()!;
    try {
      const prompted = await this.client.prompt(child.paneId, message, child.monitorAbort.signal);
      child.status = prompted.status === "blocked" ? "blocked" : isSettled(prompted.status) ? "settled" : "working";
      child.turnStartedAt = Date.now();
      child.stateChangeSeq = prompted.stateChangeSeq;
      child.fastSettledFollowupPending = isSettled(prompted.status) && child.queuedFollowups.length > 0;
    } catch (error) {
      child.queuedFollowups.unshift(message);
      this.delivery.enqueue(this.event(child, "failure", { errorMessage: `Could not submit queued follow-up: ${String(error)}` }));
    }
  }

  async followup(paneId: string, message: string): Promise<{ queued: boolean; blocked: boolean; status: string }> {
    const child = this.requireOwned(paneId);
    if (!message.trim()) throw new Error("Follow-up message must not be empty");
    if (child.status === "exited") throw new Error(`Child ${paneId} has exited`);
    const current = await this.client.getAgent(paneId);
    if (!current) throw new Error(`Child Pi is no longer running in ${paneId}`);
    if (current.status === "working") {
      child.status = "working";
      child.queuedFollowups.push(message);
      return { queued: true, blocked: false, status: "queued behind active turn" };
    }
    if (current.status === "blocked") {
      child.status = "blocked";
      child.queuedFollowups.push(message);
      return { queued: true, blocked: true, status: "queued; direct pane interaction may be required" };
    }
    if (!isSettled(current.status)) {
      child.queuedFollowups.push(message);
      return { queued: true, blocked: false, status: `queued while child status is ${current.status}` };
    }
    if (child.queuedFollowups.length) {
      child.queuedFollowups.push(message);
      await this.drainOneFollowup(child, current.stateChangeSeq);
      return { queued: true, blocked: false, status: "queued behind earlier follow-ups" };
    }
    try {
      const prompted = await this.client.prompt(paneId, message);
      child.status = prompted.status === "blocked" ? "blocked" : isSettled(prompted.status) ? "settled" : "working";
      child.turnStartedAt = Date.now();
      child.stateChangeSeq = prompted.stateChangeSeq;
      return { queued: false, blocked: child.status === "blocked", status: "submitted" };
    } catch (error) {
      const raced = await this.client.getAgent(paneId);
      if (raced?.status === "working" || raced?.status === "blocked") {
        child.status = raced.status;
        child.queuedFollowups.push(message);
        return {
          queued: true,
          blocked: raced.status === "blocked",
          status: raced.status === "blocked" ? "queued; direct pane interaction may be required" : "queued behind a direct child turn",
        };
      }
      throw error;
    }
  }

  async interrupt(paneId: string): Promise<{ interrupted: boolean; status: string }> {
    const child = this.requireOwned(paneId);
    const current = await this.client.getAgent(paneId);
    if (!current) throw new Error(`Child Pi is no longer running in ${paneId}`);
    if (isSettled(current.status)) return { interrupted: false, status: "already settled" };
    if (current.status === "blocked") return { interrupted: false, status: "blocked; interact with the child pane directly" };
    if (current.status !== "working") return { interrupted: false, status: `cannot interrupt while status is ${current.status}` };
    const checked = await this.client.getAgent(paneId);
    if (!checked || checked.status !== "working") return { interrupted: false, status: "already settled" };
    if (child.sessionPath) {
      try {
        child.interruptBaselineMessageIndex = await this.readers.get(child.sessionPath).messageCursor();
      } catch {
        child.interruptBaselineMessageIndex = undefined;
      }
    }
    await this.client.sendEscape(paneId);
    child.queuedFollowups.length = 0;
    child.interruptEpisodeSeq = checked.stateChangeSeq ?? child.stateChangeSeq ?? Date.now();
    return { interrupted: true, status: "Escape sent" };
  }

  async getResult(paneId: string): Promise<{ status: string; result?: ChildResult }> {
    const child = this.requireOwned(paneId);
    const current = await this.client.getAgent(paneId);
    if (!current) throw new Error(`Child Pi is no longer running in ${paneId}`);
    if (current.sessionPath) await this.setSessionPath(child, current.sessionPath);
    if (child.sessionPath) {
      const latest = await this.readers.get(child.sessionPath).latest(
        child.interruptEpisodeSeq !== undefined,
        child.interruptBaselineMessageIndex,
      );
      if (latest) child.latestResult = latest;
    }
    if (current.status === "working") return { status: "working", result: child.latestResult };
    if (current.status === "blocked") return { status: "blocked", result: child.latestResult };
    return child.latestResult ? { status: "completed", result: child.latestResult } : { status: "no completed result" };
  }

  shutdown(): void {
    this.closed = true;
    for (const child of this.children.values()) child.monitorAbort.abort();
    this.children.clear();
    this.readers.clear();
  }
}
