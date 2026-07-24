import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { DeliveryEvent } from "./types.ts";

export const DELIVERY_CUSTOM_TYPE = "herdr-subagent-events";
export const MAX_PARENT_MESSAGE_BYTES = 50 * 1024;

interface RenderEvent extends Omit<DeliveryEvent, "text" | "errorMessage"> {
  contentStart: number;
  contentEnd: number;
  truncated?: boolean;
}

export interface DeliveryDetails {
  events: RenderEvent[];
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function icon(kind: DeliveryEvent["kind"]): string {
  if (kind === "completion") return "✓";
  if (kind === "blocked") return "?";
  if (kind === "interrupted") return "■";
  if (kind === "incomplete") return "…";
  return "!";
}

function truncateUtf8(value: string, maximumBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return { text: value, truncated: false };
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maximumBytes) break;
    output += character;
    bytes += size;
  }
  return { text: output, truncated: true };
}

export function buildDeliveryMessage(events: DeliveryEvent[], maximumBytes = MAX_PARENT_MESSAGE_BYTES): {
  content: string;
  details: DeliveryDetails;
} {
  let content = "";
  let remaining = maximumBytes;
  const rendered: RenderEvent[] = [];

  for (const event of events) {
    const separator = content ? "\n\n" : "";
    const separatorBytes = Buffer.byteLength(separator, "utf8");
    const newlineBytes = Buffer.byteLength("\n", "utf8");
    if (remaining <= separatorBytes + newlineBytes) break;

    const rawHeading = `${icon(event.kind)} ${event.label} · ${event.paneId} · ${event.kind}`;
    const heading = truncateUtf8(rawHeading, remaining - separatorBytes - newlineBytes).text;
    const prefix = `${separator}${heading}\n`;
    const prefixBytes = Buffer.byteLength(prefix, "utf8");
    const rawBody = event.text || event.errorMessage || (event.kind === "blocked"
      ? "The child is blocked and may need direct interaction in its Herdr pane."
      : `Child state changed to ${event.kind}.`);
    const availableBody = Math.max(0, remaining - prefixBytes);
    const initialBody = truncateUtf8(rawBody, availableBody);
    let bodyText = initialBody.text;
    if (initialBody.truncated) {
      const truncationNote = "\n[Truncated in parent message; full response remains in the child session JSONL.]";
      const noteBytes = Buffer.byteLength(truncationNote, "utf8");
      if (noteBytes <= availableBody) {
        bodyText = truncateUtf8(rawBody, availableBody - noteBytes).text + truncationNote;
      } else {
        bodyText = truncateUtf8("[Truncated]", availableBody).text;
      }
    }
    const start = content.length + prefix.length;
    content += prefix + bodyText;
    remaining = maximumBytes - Buffer.byteLength(content, "utf8");
    const { text: _text, errorMessage: _errorMessage, ...metadata } = event;
    rendered.push({
      ...metadata,
      contentStart: start,
      contentEnd: content.length,
      ...(initialBody.truncated ? { truncated: true } : {}),
    });
    if (remaining <= 0) break;
  }

  return { content, details: { events: rendered } };
}

export function renderDeliveryMessage(
  message: { content: string | unknown[]; details?: DeliveryDetails },
  options: { expanded: boolean },
  theme: Theme,
) {
  const content = typeof message.content === "string" ? message.content : "";
  const events = message.details?.events ?? [];
  const lines: string[] = [];
  for (const event of events) {
    const color = event.kind === "completion" ? "success"
      : event.kind === "blocked" || event.kind === "incomplete" ? "warning"
        : "error";
    lines.push(theme.fg(color, `${icon(event.kind)} ${event.label}`)
      + theme.fg("dim", ` · ${event.paneId} · ${formatElapsed(event.elapsedMs)}`));
    const eventText = content.slice(event.contentStart, event.contentEnd).trim();
    const firstLine = eventText.split("\n", 1)[0] ?? "";
    if (!options.expanded && firstLine) lines.push(theme.fg("muted", `  ${firstLine}`));
    if (options.expanded) {
      lines.push(theme.fg("dim", `  role=${event.agentName} model=${event.model}`));
      if (event.classification) lines.push(theme.fg("dim", `  classification=${event.classification}`));
      if (event.sessionPath) lines.push(theme.fg("dim", `  session=${event.sessionPath}`));
      if (eventText) lines.push(eventText);
    }
  }
  return new Text(lines.join("\n"), 0, 0);
}

export class DeliveryScheduler {
  private readonly queue: DeliveryEvent[] = [];
  private readonly pi: Pick<ExtensionAPI, "sendMessage">;
  private readonly debounceMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private context?: ExtensionContext;
  private closed = false;

  constructor(pi: Pick<ExtensionAPI, "sendMessage">, debounceMs = 500) {
    this.pi = pi;
    this.debounceMs = debounceMs;
  }

  setContext(ctx: ExtensionContext): void {
    this.context = ctx;
    this.scheduleIfIdle();
  }

  enqueue(event: DeliveryEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    this.scheduleIfIdle();
  }

  parentSettled(ctx: ExtensionContext): void {
    this.context = ctx;
    this.scheduleIfIdle();
  }

  private scheduleIfIdle(): void {
    if (this.closed || this.timer || this.queue.length === 0 || !this.context?.isIdle()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.closed || this.queue.length === 0) return;
    if (!this.context?.isIdle()) {
      this.scheduleIfIdle();
      return;
    }
    const message = buildDeliveryMessage(this.queue);
    const consumed = message.details.events.length;
    if (!consumed) return;
    this.queue.splice(0, consumed);
    this.pi.sendMessage({
      customType: DELIVERY_CUSTOM_TYPE,
      content: message.content,
      display: true,
      details: message.details,
    }, { deliverAs: "followUp", triggerTurn: true });
    this.scheduleIfIdle();
  }

  shutdown(): void {
    this.closed = true;
    this.queue.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
