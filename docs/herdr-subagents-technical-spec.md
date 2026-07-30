# Herdr-native Pi subagents — canonical v1 technical specification

**Status:** Implemented  
**Canonical:** Yes  
**Minimum Pi version:** `0.81.1`  
**Scope:** Replace `pi-interactive-subagents` and the local child model-override extension with one Herdr-native Pi extension.

`docs/herdr-subagents-implementation-spec.md` is superseded by this document.

## 1. Objective

Provide asynchronous, directly interactive Pi subagents in Herdr tabs or split panes.

- Each child is a separate persistent Pi process and conversation.
- The user can enter the child pane and interact with it normally.
- The parent waits for child startup and successful initial task submission, but never for task completion.
- Herdr owns terminal placement, navigation, attention state, and coarse lifecycle status.
- Pi session JSONL is the authoritative result source.
- Children remain open until the user closes them.

The default placement is a new tab. A sibling split is an explicit role or launch override.

## 2. Replacement boundary

The new extension replaces:

- `node_modules/pi-interactive-subagents/pi-extension/subagents/index.ts`
- `pi-extension/subagent-model-overrides/index.ts`

After migration:

- Remove `pi-interactive-subagents` from `package.json`.
- Remove the old extension and model-override entries from `package.json#pi.extensions`.
- Register the new Herdr-native extension.
- Remove `pi-extension/subagent-model-overrides/` after its policy has moved into the new extension.

### Retained model policy

Retain the policy in `config/subagent-model-overrides.json`, migrated to the four bundled v1 roles:

| Agent | Model | Thinking |
|---|---|---|
| `explorer` | `openai-codex/gpt-5.6-luna` | `low` |
| `planner` | `openai-codex/gpt-5.6-sol` | `high` |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` |

The policy is authoritative: it overlays matching fields from the winning agent definition.

### Intentional v1 boundaries

- Herdr is the only backend.
- Children persist after every turn instead of auto-exiting.
- No parent status widget; Herdr is the status and navigation UI.
- No `/plan`, `/iterate`, `subagent_done`, or `caller_ping`.
- No parent-context forks, worktrees, scheduling, workflow DSL, or nested delegation.
- No automatic retry or model fallback.
- No registry reconstruction after `/reload` or parent-session replacement.
- No automatic child surface cleanup.
- `subagent_resume` and a blocking wait tool are deferred.

V1 does include an interactive `/subagent` launcher, `get_subagent_result`, completion coalescing, tool allowlists, and presentation-only Herdr role metadata.

## 3. Runtime and dependency requirements

The repository development dependencies must use Pi `0.81.1` or newer so implementation types match the supported runtime APIs, including `ctx.mode`, `ctx.isProjectTrusted()`, current model authentication, custom-message rendering, and `session_shutdown`.

Before the first launch in a parent session, validate and cache:

1. `ctx.mode === "tui"`.
2. `HERDR_ENV=1`.
3. `HERDR_PANE_ID` is available.
4. The `herdr` executable responds.
5. `herdr integration status` reports the Pi integration as current.
6. The resolved child model exists.
7. Model-specific credentials resolve with `ctx.modelRegistry.getApiKeyAndHeaders(model)`.

Derive workspace and tab identity from `herdr pane current --current` or `herdr pane get`; do not require redundant environment variables when Herdr can report them.

`herdr integration status` currently returns human-readable text. Keep its parsing in the Herdr adapter and accept only an anchored Pi line matching the semantic form `pi: current (...)`. Any other Pi status is an actionable failure. Do not spread text parsing through orchestration code.

Validation failure creates no surface and returns an actionable error. Missing or outdated integration errors recommend:

```bash
herdr integration install pi
```

The extension never installs or updates Herdr integrations automatically. Credential validation is a configuration check, not a guarantee that the first provider request will succeed.

## 4. Agent definitions

Definitions are Markdown files with YAML frontmatter and a role-prompt body.

```yaml
---
name: explorer
description: Fast codebase reconnaissance
model: openai-codex/gpt-5.6-luna
thinking: low
placement: tab
tools: read,bash
---
```

Recognized fields:

| Field | Required | Notes |
|---|---:|---|
| `name` | yes | Case-insensitive invocation name |
| `description` | yes | Discovery and launcher description |
| `model` | no | Required after model-policy overlay |
| `thinking` | no | Defaults to the parent thinking level |
| `placement` | no | `tab` or `split`; default `tab` |
| `tools` | no | Comma-separated Pi tool allowlist passed through to `--tools` |

The body is appended to Pi's normal system prompt and project instructions. Unknown frontmatter fields are ignored with no promised behavior.

Use a direct YAML dependency or Pi's supported frontmatter parser; do not implement YAML with regular expressions. Any runtime parser package imported by this package must be a direct dependency.

### Discovery and trust

Discovery order, lowest to highest priority:

1. Extension-bundled definitions
2. Global definitions from Pi's `getAgentDir()/agents`
3. Project definitions from `<cwd>/<CONFIG_DIR_NAME>/agents`, only when `ctx.isProjectTrusted()` is true

Higher-priority definitions replace lower-priority definitions by normalized name. Duplicate normalized names in one scope are errors and list every conflicting path.

Files that cannot produce a normalized `name` are reported as scope diagnostics with their exact path. They do not shadow a valid named definition. An invalid winning named definition reports its exact path and fields and does not silently fall back.

Definitions are loaded on extension startup and `/reload`; hot file watching is not required.

Resolution order:

1. Select the winning definition.
2. Overlay `config/subagent-model-overrides.json` for that normalized role name.
3. Apply the parent thinking level only if thinking remains unset.
4. Apply placement default `tab` if placement remains unset.
5. Validate model, thinking, placement, and tool names.

`subagents_list` returns resolved definitions with source, source path, model, thinking, placement, tools, and any discovery diagnostics. Running children remain visible through Herdr rather than being mixed into this contract.

## 5. Bundled roles and prompt adaptation

Ship four bundled definitions:

| Role | Model | Thinking | Placement | Tools | Responsibility |
|---|---|---|---|---|---|
| `explorer` | `openai-codex/gpt-5.6-luna` | `low` | `tab` | `read,bash` | Inspect and report; never modify files |
| `planner` | `openai-codex/gpt-5.6-sol` | `high` | `tab` | `read,bash` | Investigate, clarify consequential decisions, and produce a plan; never implement |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` | `tab` | `read,bash,write,edit` | Implement and validate the assigned task |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` | `tab` | `read,bash` | Inspect and report actionable findings; never modify files |

Do not copy the upstream prompts verbatim. Write new prompts for the Herdr runtime with these requirements:

- Never instruct a child to spawn another subagent; nested delegation is unavailable.
- Never require a tool excluded by the role allowlist.
- Do not instruct the child to exit after a response. It remains open for direct interaction and follow-ups.
- Do not assume todo, commit, artifact, or browser-control skills are available.
- Explorer and reviewer report in their final response rather than requiring output files.
- Planner asks only consequential questions, incrementally, in its pane; it makes minor implementation assumptions explicitly.
- Worker handles minor implementation choices autonomously and asks in its pane when a major decision blocks safe progress.
- Reviewer reports findings only; applying fixes remains worker work.

`visual-tester` is deferred until its Chrome CDP skill and runtime prerequisites can be bundled and tested.

## 6. Public API

All control tools only accept pane IDs present in the current parent runtime's tracked-child registry. They must reject the parent pane, closed children, surviving children from an earlier runtime, and unrelated Herdr panes. Pane IDs remain opaque strings.

### `subagent`

Launch a fresh child:

```ts
{
  agent: string;
  task: string;
  name?: string;
  placement?: "tab" | "split";
}
```

The call waits for surface creation, Pi readiness, baseline capture, and successful task submission. It then returns without waiting for completion.

The result includes pane ID, tab ID, label, resolved role, model, thinking, placement, and session path when available.

### `subagent_followup`

Submit another parent-originated prompt:

```ts
{ paneId: string; message: string }
```

- Settled child: submit immediately.
- Working child: enqueue FIFO.
- Blocked child: enqueue and tell the caller that direct pane interaction may be required.
- Send at most one queued follow-up after each settled turn.

Immediately re-read child status before draining a queued follow-up. If a direct user turn has already started, keep the follow-up queued. A blocked state may represent an interactive selector or permission prompt, so plain text must not be assumed to resolve it.

### `subagent_interrupt`

Cancel the active child turn without closing its pane or Pi process:

```ts
{ paneId: string }
```

- Working child: re-read status, then send Escape with `herdr agent send-keys <pane> escape`.
- Settled child: return idempotent `already settled`.
- Blocked child: do not send Escape automatically; return a needs-direct-interaction result.
- Clear queued follow-ups only after the Escape request is accepted.

Herdr does not offer an atomic compare-status-and-send operation. Document the small race between the final status check and Escape delivery. Never send Escape based only on stale in-memory status.

Interrupt attribution is turn-scoped, not a permanent boolean. Record the target working episode/state sequence and clear it at the next settlement, session replacement, or exit even if no aborted assistant entry appears.

### `get_subagent_result`

Return the latest completed assistant response for a tracked persistent child without waiting:

```ts
{ paneId: string }
```

Return `working`, `blocked`, or `no completed result` when appropriate. Reconcile the session JSONL before responding; do not rely only on the cached delivered result. Retrieval is one-shot per result entry: repeated calls return metadata without repeating response text. The default model-visible retrieval limit is 16 KiB and callers may request up to 50 KiB. If the matching automatic handoff is still queued, cancel it before returning the result so it cannot trigger a redundant parent turn.

### `subagents_list`

Return resolved definitions and discovery diagnostics only.

## 7. `/subagent` command

Supported direct forms:

```text
/subagent explorer Find the authentication entry points
/subagent reviewer --placement split Review the current diff
```

A complete command launches immediately.

Bare `/subagent` opens a TUI flow:

1. Select a resolved agent definition.
2. Confirm or toggle `tab`/`split`; the resolved default is preselected.
3. Enter the task with Pi's multiline editor.
4. Launch.

Use Pi's existing `SelectList`/custom UI and editor APIs rather than creating a separate Herdr navigator. In non-TUI modes, return concise usage instead of attempting the picker.

Command parsing recognizes `--placement tab|split` only before task text. `--` ends option parsing. Invalid or duplicate placement options fail rather than becoming task text accidentally.

## 8. Placement, labels, and launch flow

Placement precedence:

1. Per-launch override
2. Agent-definition default
3. Global fallback `tab`

### Tab placement

Create a tab in the parent's workspace with explicit workspace ID, parent cwd, child marker environment, label, and `--no-focus`. Parse both tab and pane IDs from Herdr's JSON response.

### Split placement

Create a split relative to the immutable parent pane ID with parent cwd, child marker environment, and `--no-focus`.

Inspect the parent rectangle from `herdr pane layout --pane <parent-pane>` and use this deterministic rule:

- Constants: `MIN_SPLIT_WIDTH = 60`, `MIN_SPLIT_HEIGHT = 16`.
- Choose `right` when `floor(width / 2) >= MIN_SPLIT_WIDTH` and either a vertical split would violate minimum height or `width >= 2 * height`.
- Otherwise choose `down` when `floor(height / 2) >= MIN_SPLIT_HEIGHT`.
- Otherwise, if only the right split satisfies its minimum, choose `right`.
- If neither split satisfies its minimum, fail before creating a surface and recommend tab placement.

The constants and pure direction function must be unit tested.

### Labels and metadata

The Herdr pane ID is the only parent-side child identifier. Do not create a second run-ID namespace.

An optional caller `name` controls the human-facing label. Otherwise derive a concise label from role and task, for example:

```text
[E] Explorer: Auth flow
[P] Planner: Cache design
[W] Worker: Pagination
[R] Reviewer: Pagination
```

Ensure uniqueness among children tracked by this runtime by appending `(2)`, `(3)`, and so on.

Apply the label to the tab and/or pane. Report a presentation-only `role=<normalized-role>` token with `herdr pane report-metadata` under an extension-specific source ID. This metadata never replaces Herdr's canonical `pi` lifecycle agent and is not used for correctness.

### Launch flow

1. Validate TUI mode, Herdr, integration, definition, model, and credentials.
2. Resolve placement and a unique label.
3. Create the tab or split with parent cwd and child marker environment.
4. Parse returned IDs; never construct or predict them.
5. Apply labels and presentation metadata.
6. Create a private temporary directory and mode-`0600` role-prompt file.
7. Derive a strict, deterministic Herdr control name from the normalized role and returned pane ID, then start Pi with `herdr agent start <control-name> --kind pi --pane <pane> --timeout <ms> -- <pi-args>`. The control name exists only because Herdr requires one; parent APIs continue to identify children exclusively by pane ID.
8. Pass exact model, thinking, optional tools, and `--append-system-prompt <file>` in `pi-args`.
9. Wait for initial interactive readiness when `agent start` has not already established it.
10. Read the child session path and baseline all existing assistant entry IDs before task submission.
11. Submit the task with `herdr agent prompt` and establish that it was accepted.
12. Register the lifecycle monitor.
13. Remove the temporary prompt file/directory in a `finally` path after startup has consumed it.
14. Return to the parent without waiting for completion.

Use shell-free argv execution through `pi.exec` or equivalent `execFile` semantics. Do not pass the task as a Pi argv prompt.

If surface creation succeeds but startup fails, return the concrete error and pane ID and leave the surface open.

Child environment:

```text
PI_HERDR_SUBAGENT=1
PI_HERDR_AGENT=<agent-name>
```

When `PI_HERDR_SUBAGENT=1`, this extension registers no orchestration tools, command, monitors, or metadata of its own, disabling nested delegation through this extension.

## 9. Lifecycle monitoring

Herdr's official Pi integration is the coarse lifecycle authority. Use `herdr agent get`, `herdr agent wait`, and `herdr pane get`; never scrape terminal output for automatic results.

Normalize Herdr status:

- `working` → working
- `blocked` → blocked
- `idle` or `done` → settled
- `unknown` or no live agent → reconcile startup/process exit

A `done -> idle` attention change is not a new turn.

### Monitor algorithm

Use one abortable monitor loop per tracked child:

1. Inspect current agent and pane state before waiting.
2. Run `herdr agent wait` for statuses relevant to the current phase with a maximum two-second timeout.
3. After every status response, timeout, malformed response, or wait error, reconcile with `agent get`, `pane get`, and the session JSONL.
4. Ignore the initial settled state captured before task submission.
5. Never busy-loop on a currently matching settled status; after settlement, wait for `working`, `blocked`, or agent disappearance while the periodic two-second JSONL reconciliation continues.
6. On working, record the current Herdr state-change sequence as the turn episode when available.
7. On blocked, emit one compact notice per blocked episode.
8. On every reconciliation, queue a compact handoff for every unseen final assistant entry in append order, unless that entry was already explicitly retrieved.
9. After settlement reconciliation, re-check status before sending at most one queued follow-up.
10. Abort all waits and suppress late callbacks when the parent runtime shuts down.

A missed `working` observation must only delay delivery by the reconciliation interval; it must never suppress a valid result. JSONL identity, not status transition history, is the delivery guard.

### Direct child turns

Relay every new completed child response, including turns initiated directly by the user in the child pane. This intentionally keeps the parent synchronized without prompt-origin bookkeeping.

### Exit and closure

- If Pi exits while its pane remains open, mark the child `exited`, stop monitoring, and notify once if work was pending.
- If the pane disappears while working or blocked, send one incomplete/closed notice.
- If the pane disappears after all latest results were delivered and it was settled, stop silently.

## 10. JSONL extraction

Read the session path from:

```text
result.pane.agent_session.value
```

Maintain reader state per session path: byte offset, trailing partial bytes, observed entry IDs, and delivered entry IDs.

The reader must:

- Ignore an incomplete trailing line until completed.
- Track byte offsets without splitting UTF-8 sequences.
- Detect file truncation and session-path replacement.
- Inspect only `type: "message"` entries whose `message.role` is `assistant`.
- Use `SessionMessageEntry.id` as identity.
- Concatenate all non-empty assistant text blocks.
- Preserve stop reason, error message, provider, model, timestamp, and session path.
- Return all unseen final entries in append order, not just the newest entry.

Classification:

| Condition | Classification |
|---|---|
| `stopReason: stop` with text | success |
| `stopReason: length` | incomplete; preserve partial text |
| `stopReason: error` | failure |
| `stopReason: aborted` for the matching parent-interrupted turn | interrupted |
| `stopReason: aborted` otherwise | failure |
| `stopReason: toolUse` | intermediate; never deliver |
| No new final assistant entry | no delivery |

When the child changes Pi sessions interactively, establish a baseline for the replacement path before allowing delivery. Do not relay historical responses from that session.

Terminal output is diagnostic-only and never a result fallback.

## 11. Parent delivery and coalescing

Use Pi custom messages with `deliverAs: "followUp"` and `triggerTurn: true`.

Do not call `sendMessage` once per result immediately. Instead:

1. Add completion and attention events to an in-memory delivery queue.
2. If the parent is busy, retain the queue until `agent_settled`.
3. Once the parent is idle, start a fixed 500 ms debounce.
4. Combine events arriving during that window into one custom follow-up message.
5. Trigger one parent turn for that batch.
6. If the parent becomes busy before flush, retain the batch until it settles again.

This scheduler is only a small delivery coalescer; it does not control child execution. A blocked notice should not be delayed behind an indefinitely busy child because it depends only on parent state.

Register one custom message renderer. Each child event renders as an independently expandable block.

Collapsed completion example:

```text
✓ [E] Explorer: Auth flow · w1:p4 · 23s
  Found three authentication entry points…
```

Expanded details include the compact handoff text, resolved role/model, pane ID, result entry ID, elapsed time, classification, and session path. Do not duplicate response text in renderer details.

Bundled role prompts target compact final handoffs. Independently cap each automatic response excerpt at 6 KiB of valid UTF-8 and each combined parent custom message at 16 KiB. Mark truncation explicitly, direct the parent to `get_subagent_result`, and retain the full response only in the child session JSONL.

Track result delivery as `queued`, `delivered`, or `retrieved`. Explicit retrieval cancels a matching queued handoff. A delivered compact handoff may be followed by one explicit bounded retrieval, but the full response must never be returned twice.

Register a `context` hook that keeps an unread handoff during the parent run consuming it, including intermediate tool-use turns and failed, interrupted, or length-limited attempts, then omits that custom message from later model calls only after a successful parent response with `stopReason: stop`. The persisted transcript remains unchanged.

The renderer must support completion, blocked, interrupted, incomplete, failure, exited, and closed states.

## 12. State and shutdown

Tracked state is intentionally in-memory:

```ts
interface TrackedSubagent {
  paneId: string;
  tabId: string;
  agentName: string;
  agentSourcePath: string;
  label: string;
  placement: "tab" | "split";
  model: string;
  thinking: string;
  sessionPath?: string;
  status: "starting" | "working" | "blocked" | "settled" | "exited";
  queuedFollowups: string[];
  lastObservedEntryId?: string;
  lastDeliveredEntryId?: string;
  lastRetrievedEntryId?: string;
  resultDeliveryStates: Map<string, "queued" | "delivered" | "retrieved">;
  interruptEpisodeSeq?: number;
  startedAt: number;
  turnStartedAt?: number;
}
```

Reader offsets and full observed/delivered ID sets may live in a separate per-path reader state rather than this illustrative record.

No registry is persisted in v1. On `/reload`, `/new`, `/resume`, `/fork`, or parent exit:

- Mark the runtime generation closed.
- Abort monitor and wait subprocesses.
- Cancel pending delivery timers.
- Do not close child panes.
- Do not stop child Pi processes.
- Do not reconnect the replacement parent runtime.

Surviving children remain usable directly through Herdr. Control tools in the new runtime reject them as untracked.

## 13. Concurrency and safety

All children share the parent checkout in v1.

- Parallel read-only agents are supported.
- Run at most one writing worker at a time unless tasks are explicitly known to touch disjoint files.
- The `subagent` tool description warns that concurrent writers are not isolated and may overwrite each other's work.
- Agent tool restrictions reduce accidental mutation but are not a security sandbox, especially when `bash` is allowed.
- Project agent definitions are repository-controlled input and load only for trusted projects.
- Never control an untracked pane, even if it currently hosts Pi.

## 14. Module responsibilities

Start with these boundaries:

| Module | Responsibility |
|---|---|
| `index.ts` | Child guard, extension wiring, session cleanup |
| `agents.ts` | Discovery, parsing, precedence, trust, policy merge |
| `herdr.ts` | Typed CLI adapter, validation, surfaces, startup, prompts, controls, metadata |
| `monitor.ts` | Lifecycle state machine and follow-up queue |
| `session-reader.ts` | Incremental JSONL extraction and classification |
| `delivery.ts` | Dedupe, 500 ms coalescing, limits, parent custom messages |
| `ui.ts` | Tools, `/subagent` parser/picker, rendering |
| `types.ts` | Shared internal types |

Bundled definitions live under `pi-extension/herdr-subagents/agents/`.

## 15. Error policy

Do not silently change execution policy or retry automatically.

- Outside TUI/Herdr: actionable failure.
- Missing/outdated integration: recommend `herdr integration install pi`.
- Invalid winning definition: exact path and field diagnostics.
- Duplicate agent name in one scope: list conflicting paths.
- Missing model or credentials: fail before surface creation.
- Uncomfortable split geometry: fail and recommend tab placement.
- Surface or startup failure: return the concrete Herdr error and pane ID if created; leave the surface open.
- Missing session metadata/JSONL: structured extraction failure; no screen scraping.
- Pi exited or pane closed while work was pending: one incomplete notification.
- Untracked control target: fail without invoking Herdr.
- Malformed Herdr JSON: include command name and bounded stderr/stdout diagnostics without leaking credentials or prompt-file contents.

## 16. Verification

Automated tests use an injected fake `HerdrClient`; they do not create real panes.

Required coverage:

- TUI/Herdr/integration validation and anchored integration-status parsing
- Model existence and model-specific credential failure
- Trusted definition discovery, precedence, malformed-file diagnostics, duplicate detection, and policy overlay
- Adapted bundled-role metadata and tool restrictions
- Herdr JSON parsing and opaque pane IDs
- Default tab creation and explicit split creation
- Deterministic split thresholds, direction, and too-small failure
- Launch waits for startup/task submission but not task completion
- Temporary prompt cleanup on success and every startup failure
- Owned-pane enforcement for follow-up, interrupt, and result tools
- Initial settled-state suppression and `idle`/`done` normalization
- New JSONL delivery when `working` was not observed
- JSONL partial UTF-8 writes, truncation, session replacement, concurrent refresh serialization, and stop-reason classification
- Delivery of multiple unseen final entries in append order
- Automatic relay of both parent-originated and direct-child turns
- Follow-up FIFO, one-per-settlement draining, and direct-turn race recheck
- Blocked follow-up and interrupt behavior
- Turn-scoped interrupt attribution and queue clearing
- 500 ms parent delivery coalescing while idle and after `agent_settled`
- Per-handoff and parent-message UTF-8 truncation without response text in details
- `get_subagent_result` one-shot reconciliation, queued-handoff cancellation, and repeated-retrieval suppression
- Context pruning only after a successful parent response consumes a handoff, while retryable attempts retain it
- Pane missing versus Pi exited in a surviving pane
- Parent shutdown aborts monitors/timers and leaves children running
- Child marker disables all orchestration registration

A separate manual Herdr test verifies real tab/split creation, labels/role metadata, picker launch, direct interaction, coalesced completion delivery, result lookup, follow-up, interruption, process exit, and parent shutdown behavior.

## 17. Deferred enhancements

Add only after real usage demonstrates a need:

- Same-parent reconnection after `/reload` or session resume
- `subagent_resume`
- Blocking `subagent_wait`
- Worktree or alternate-cwd isolation
- Per-agent auto-close or delivery policies
- Model fallback
- Configurable completion batching
- Optional suppression of direct-child result relay
- Cross-extension RPC
- Richer Herdr metadata and panel styling
- `visual-tester` after bundling and validating its browser-control prerequisites
