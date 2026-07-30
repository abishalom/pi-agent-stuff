import { open, stat } from "node:fs/promises";
import type { ChildResult, ResultClassification } from "./types.ts";

interface AssistantEntry {
  id: string;
  messageIndex: number;
  stopReason: string;
  text: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractAssistantEntry(value: unknown, messageIndex: number): AssistantEntry | undefined {
  const entry = asRecord(value);
  const message = asRecord(entry?.message);
  if (entry?.type !== "message" || message?.role !== "assistant" || typeof entry.id !== "string") return undefined;
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .map(asRecord)
    .filter((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim())
    .map((block) => block!.text as string)
    .join("\n\n");
  const rawTimestamp = typeof message.timestamp === "number" ? message.timestamp : Date.parse(String(entry.timestamp ?? ""));
  return {
    id: entry.id,
    messageIndex,
    stopReason: typeof message.stopReason === "string" ? message.stopReason : "",
    text,
    errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : undefined,
    provider: typeof message.provider === "string" ? message.provider : undefined,
    model: typeof message.model === "string" ? message.model : undefined,
    timestamp: Number.isFinite(rawTimestamp) ? rawTimestamp : undefined,
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function classify(entry: AssistantEntry, parentInterrupted: boolean): ResultClassification | null {
  if (entry.stopReason === "toolUse") return null;
  if (entry.stopReason === "stop" && entry.text) return "success";
  if (entry.stopReason === "length") return "incomplete";
  if (entry.stopReason === "aborted") return parentInterrupted ? "interrupted" : "failure";
  if (entry.stopReason === "error") return "failure";
  return entry.text ? "failure" : null;
}

export class IncrementalSessionReader {
  readonly path: string;
  private offset = 0;
  private trailing = Buffer.alloc(0);
  private inode?: number;
  private readonly entries = new Map<string, AssistantEntry>();
  private readonly order: string[] = [];
  private readonly delivered = new Set<string>();
  private readonly baselined = new Set<string>();
  private readonly userMessageIndexes: number[] = [];
  private nextMessageIndex = 0;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private resetForReplacement(nextInode?: number): void {
    this.offset = 0;
    this.trailing = Buffer.alloc(0);
    this.inode = nextInode;
    this.entries.clear();
    this.order.length = 0;
    this.userMessageIndexes.length = 0;
    this.nextMessageIndex = 0;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async refreshUnlocked(): Promise<void> {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(this.path);
    } catch (error) {
      // Pi advertises the reserved session path as soon as its TUI is ready, but
      // does not create the JSONL file until the first message is submitted.
      if (isMissingFile(error)) return;
      throw error;
    }
    const inode = typeof info.ino === "number" ? info.ino : undefined;
    const replaced = (this.inode !== undefined && inode !== undefined && this.inode !== inode) || info.size < this.offset;
    if (replaced) {
      this.resetForReplacement(inode);
    } else if (this.inode === undefined) {
      this.inode = inode;
    }
    if (info.size === this.offset) return;

    const length = info.size - this.offset;
    const chunk = Buffer.alloc(length);
    const handle = await open(this.path, "r");
    try {
      let read = 0;
      while (read < length) {
        const result = await handle.read(chunk, read, length - read, this.offset + read);
        if (result.bytesRead === 0) break;
        read += result.bytesRead;
      }
      this.offset += read;
      const combined = Buffer.concat([this.trailing, chunk.subarray(0, read)]);
      let start = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) continue;
        const line = combined.subarray(start, index);
        start = index + 1;
        if (!line.length) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line.toString("utf8"));
        } catch (error) {
          throw new Error(`Malformed child session JSONL in ${this.path}: ${String(error)}`);
        }
        const parsedEntry = asRecord(parsed);
        const parsedMessage = asRecord(parsedEntry?.message);
        if (parsedEntry?.type !== "message" || typeof parsedEntry.id !== "string" || !parsedMessage) continue;
        const messageIndex = this.nextMessageIndex++;
        if (parsedMessage.role === "user") this.userMessageIndexes.push(messageIndex);
        const assistant = extractAssistantEntry(parsed, messageIndex);
        if (assistant && !this.entries.has(assistant.id)) {
          this.entries.set(assistant.id, assistant);
          this.order.push(assistant.id);
        }
      }
      this.trailing = combined.subarray(start);
      if (replaced) {
        for (const id of this.order) {
          this.delivered.add(id);
          this.baselined.add(id);
        }
      }
    } finally {
      await handle.close();
    }
  }

  async refresh(): Promise<void> {
    await this.runExclusive(() => this.refreshUnlocked());
  }

  async baseline(): Promise<void> {
    await this.runExclusive(async () => {
      await this.refreshUnlocked();
      for (const id of this.order) {
        this.delivered.add(id);
        this.baselined.add(id);
      }
    });
  }

  async messageCursor(): Promise<number> {
    return this.runExclusive(async () => {
      await this.refreshUnlocked();
      return this.nextMessageIndex;
    });
  }

  private belongsToInterruptedTurn(entry: AssistantEntry, baselineMessageIndex?: number): boolean {
    if (baselineMessageIndex === undefined || entry.messageIndex < baselineMessageIndex) return false;
    return !this.userMessageIndexes.some((index) => index >= baselineMessageIndex && index < entry.messageIndex);
  }

  async scanUnseen(parentInterrupted = false, interruptBaselineMessageIndex?: number): Promise<ChildResult[]> {
    return this.runExclusive(async () => {
      await this.refreshUnlocked();
      const results: ChildResult[] = [];
      for (let index = 0; index < this.order.length; index += 1) {
        const id = this.order[index]!;
        if (this.delivered.has(id)) continue;
        const entry = this.entries.get(id)!;
        const belongsToInterrupt = parentInterrupted && this.belongsToInterruptedTurn(entry, interruptBaselineMessageIndex);
        const classification = classify(entry, belongsToInterrupt);
        if (!classification) continue;
        this.delivered.add(id);
        results.push({
          entryId: entry.id,
          text: entry.text,
          classification,
          stopReason: entry.stopReason,
          errorMessage: entry.errorMessage,
          provider: entry.provider,
          model: entry.model,
          timestamp: entry.timestamp,
          sessionPath: this.path,
        });
      }
      return results;
    });
  }

  async latest(parentInterrupted = false, interruptBaselineMessageIndex?: number): Promise<ChildResult | undefined> {
    return this.runExclusive(async () => {
      await this.refreshUnlocked();
      for (let index = this.order.length - 1; index >= 0; index -= 1) {
        const id = this.order[index]!;
        if (this.baselined.has(id)) continue;
        const entry = this.entries.get(id)!;
        const classification = classify(entry, parentInterrupted && this.belongsToInterruptedTurn(entry, interruptBaselineMessageIndex));
        if (!classification) continue;
        return {
          entryId: entry.id,
          text: entry.text,
          classification,
          stopReason: entry.stopReason,
          errorMessage: entry.errorMessage,
          provider: entry.provider,
          model: entry.model,
          timestamp: entry.timestamp,
          sessionPath: this.path,
        };
      }
      return undefined;
    });
  }

  hasDelivered(entryId: string): boolean {
    return this.delivered.has(entryId);
  }
}

export class SessionReaderStore {
  private readonly readers = new Map<string, IncrementalSessionReader>();

  get(path: string): IncrementalSessionReader {
    let reader = this.readers.get(path);
    if (!reader) {
      reader = new IncrementalSessionReader(path);
      this.readers.set(path, reader);
    }
    return reader;
  }

  clear(): void {
    this.readers.clear();
  }
}
