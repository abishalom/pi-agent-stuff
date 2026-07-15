# 2026-07-15 Herdr subagents usage

This package includes a `herdr` skill for explicit Herdr-based agent orchestration.

## Support boundary

The upstream `pi-interactive-subagents` package currently supports `cmux`, `tmux`,
`zellij`, and `wezterm` as native multiplexer backends. Herdr is not currently a
native backend, so do not set `PI_SUBAGENT_MUX=herdr`.

When Herdr is requested, use the Herdr CLI directly. This gives the child agent a
real Herdr pane and preserves Herdr status tracking, but it does not provide the
upstream extension's automatic result steering, interruption, or resume behavior.

## Manual Herdr workflow

Confirm that the current session is Herdr-managed:

```bash
test "${HERDR_ENV:-}" = 1
```

Create a sibling pane without stealing focus:

```bash
herdr pane split --current --direction right --no-focus
```

Parse the JSON response for the returned `pane_id`; never predict pane IDs. Then:

```bash
herdr pane rename <pane_id> "scout"
herdr pane run <pane_id> "pi"
herdr wait agent-status <pane_id> --status idle --timeout 30000
herdr pane run <pane_id> "Read the requested files and report concise findings."
herdr wait agent-status <pane_id> --status done --timeout 120000
herdr pane read <pane_id> --source recent-unwrapped --lines 120
```

If the pane is visible to the user, completion may report as `idle` instead of
`done`; inspect `herdr pane get <pane_id>` and treat either state as complete.
Use `--direction down` when the current layout is narrow or tall. Keep the user's
focus in the calling pane with `--no-focus`.

## Safety rules

- Run `herdr --help` and the relevant command-group help before relying on syntax.
- Use `--current` or IDs returned by Herdr; do not target the focused pane implicitly.
- Do not close panes, tabs, or workspaces that the current task did not create.
- Do not run `herdr server stop` from an active session.
- Use the normal `pi` executable in child panes so the installed package and model
  override extension are loaded.

## Agent model policy

The package applies these local model/thinking defaults through
`config/subagent-model-overrides.json`:

| Agent | Model | Thinking |
|---|---|---|
| `planner` | `openai-codex/gpt-5.6-sol` | `high` |
| `scout` | `openai-codex/gpt-5.6-luna` | `minimal` |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` |
| `visual-tester` | `openai-codex/gpt-5.6-luna` | `low` |

`claude-code` remains an external CLI agent and is not configured by the
OpenAI-Codex model override file.
