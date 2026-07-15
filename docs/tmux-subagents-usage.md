# Subagents usage in this repo

This repo uses the upstream `pi-interactive-subagents` package for subagent behavior.
Herdr instructions are packaged separately for explicit manual orchestration; see
`docs/2026-07-15-herdr-subagents-usage.md`.

## Start Pi inside an upstream-supported multiplexer

Examples:

```bash
cmux pi
# or
tmux new -A -s pi 'pi'
# or
zellij --session pi
```

Optional:

```bash
export PI_SUBAGENT_MUX=tmux
```

## Core commands

- `/plan <task>`
- `/iterate <task>`
- `/subagent <agent> <task>`

## Core tools

- `subagent`
- `subagent_resume`
- `subagents_list`
- `set_tab_title`
- `write_artifact`
- `read_artifact`

The upstream package natively supports `cmux`, `tmux`, `zellij`, and `wezterm`.
Herdr is not a native backend; use the packaged Herdr skill for manual pane
orchestration when explicitly requested.

## Agent model/thinking overrides in this repo

This repo does not override upstream prompts.

Instead, it applies runtime model/thinking overrides from:

- `config/subagent-model-overrides.json`

Current defaults:

| Agent | Model | Thinking |
|---|---|---|
| `planner` | `openai-codex/gpt-5.6-sol` | `high` |
| `scout` | `openai-codex/gpt-5.6-luna` | `minimal` |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` |
| `visual-tester` | `openai-codex/gpt-5.6-luna` | `low` |

## How updates behave

When the upstream package updates, this repo should pick up:
- new bundled prompt content
- orchestration changes
- UI and multiplexer fixes

The local override extension should continue to apply model/thinking policy as long as the upstream package keeps exposing subagent identity through `PI_SUBAGENT_AGENT`.
