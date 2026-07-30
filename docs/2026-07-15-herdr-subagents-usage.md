# 2026-07-15 Herdr subagents usage

This package includes a Herdr-native Pi subagents extension and a `herdr` skill for direct terminal orchestration.

## Requirements

- Run the parent Pi TUI inside Herdr (`HERDR_ENV=1`).
- Keep Herdr's Pi integration current:

  ```bash
  herdr integration install pi
  ```

- Configure credentials for the selected child model in Pi.

The extension validates these requirements before creating a child surface.

## Launching a child

Use the `subagent` tool or `/subagent` command:

```text
/subagent explorer Find the authentication entry points
/subagent reviewer --placement split Review the current diff
```

Bare `/subagent` opens an interactive role, placement, and task picker.

Children open in background tabs by default. Pass `placement: "split"` to the tool or `--placement split` to the command for a sibling split. A launch returns after Pi is ready and the initial task has been submitted; the child continues asynchronously.

Each child is a persistent interactive Pi session. Enter its Herdr pane to watch progress, answer questions, or continue the conversation directly. The extension does not close child panes after a response.

## Bundled roles

| Role | Model | Thinking | Tools | Purpose |
|---|---|---|---|---|
| `explorer` | `openai-codex/gpt-5.6-luna` | `low` | `read,bash` | Read-only reconnaissance |
| `planner` | `openai-codex/gpt-5.6-sol` | `high` | `read,bash` | Investigation and implementation planning |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` | `read,bash,write,edit` | Focused implementation and validation |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` | `read,bash` | Read-only actionable review findings |

The resolved model/thinking policy comes from `config/subagent-model-overrides.json`. Trusted projects may override role definitions under `.pi/agents/`; global definitions live under Pi's agent directory. Use `subagents_list` to inspect resolved definitions and diagnostics.

## Parent control tools

- `subagent_followup`: submit a follow-up immediately or queue it FIFO behind active work.
- `subagent_interrupt`: send Escape to a working child without closing its pane or Pi process.
- `get_subagent_result`: retrieve the latest completed response once without waiting. The default model-visible limit is 16 KiB and callers may request up to 50 KiB.
- `subagents_list`: show resolved role definitions and discovery diagnostics.

Control tools accept only pane IDs launched by the current parent runtime. They reject unrelated panes and children surviving an earlier `/reload`, session replacement, or parent process.

A blocked child may be displaying a selector or permission prompt. Follow-ups are queued, and interrupts require direct pane interaction rather than blindly injecting text or Escape.

## Result delivery

Herdr provides coarse child lifecycle status. The extension reads exact responses from the child's Pi session JSONL and automatically sends a compact handoff back to the parent. Bundled roles are instructed to keep that handoff concise; defensive delivery limits cap each response excerpt at 6 KiB and each combined parent message at 16 KiB. The full response remains in the child JSONL.

Closely timed events are combined into one parent follow-up after a 500 ms debounce. Expand the custom result message to see role/model, pane ID, classification, elapsed time, and session path. After a successful parent response consumes a handoff, later model calls omit that old custom message while the session transcript still retains it. Failed, interrupted, or length-limited attempts keep the handoff available for retry.

Use `get_subagent_result` only when the compact handoff omitted needed detail. Retrieval is one-shot: repeated calls do not inject the same full response again. If retrieval happens while its automatic handoff is still queued, the queued handoff is cancelled to avoid a redundant parent turn. Direct turns initiated in a child pane are also relayed through compact handoffs.

## Lifecycle and safety

- Children share the parent checkout; do not run concurrent writing workers unless their files are known to be disjoint.
- Child tool allowlists reduce accidental mutation but are not a security sandbox, especially when `bash` is available.
- Nested subagent delegation is disabled in children.
- `/reload`, `/new`, `/resume`, `/fork`, and parent exit stop monitoring but leave child panes and Pi processes running for direct use.
- V1 does not reconnect surviving children, create worktrees, retry failed models, or auto-close surfaces.

## Manual Herdr fallback

For direct terminal orchestration outside the extension, use Herdr's current CLI syntax and parse returned JSON IDs rather than predicting them:

```bash
herdr pane split --current --direction right --no-focus
herdr pane rename <pane_id> "manual-child"
herdr agent start manual-child --kind pi --pane <pane_id> --timeout 30000
herdr agent prompt <pane_id> "Investigate the requested issue."
herdr agent wait <pane_id> --until idle --until done --timeout 120000
herdr pane read <pane_id> --source recent-unwrapped --lines 120
```

Treat both `idle` and `done` as settled. Use `--no-focus`, target `--current` or explicit returned IDs, and never close Herdr resources you did not create.
