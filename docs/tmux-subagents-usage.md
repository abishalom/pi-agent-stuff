# Upstream subagents usage in this repo

This repo uses the upstream `pi-interactive-subagents` package for subagent behavior.

## Start Pi inside a supported multiplexer

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

## Agent model/thinking overrides in this repo

This repo does not override upstream prompts.

Instead, it applies runtime model/thinking overrides from:

- `config/subagent-model-overrides.json`

Current defaults:

| Agent | Model | Thinking |
|---|---|---|
| `planner` | `openai-codex/gpt-5.4` | `high` |
| `scout` | `openai-codex/gpt-5.4-mini` | `minimal` |
| `worker` | `openai-codex/gpt-5.4` | `medium` |
| `reviewer` | `openai-codex/gpt-5.4` | `high` |
| `visual-tester` | `openai-codex/gpt-5.4` | `low` |

## How updates behave

When the upstream package updates, this repo should pick up:
- new bundled prompt content
- orchestration changes
- UI and multiplexer fixes

The local override extension should continue to apply model/thinking policy as long as the upstream package keeps exposing subagent identity through `PI_SUBAGENT_AGENT`.
