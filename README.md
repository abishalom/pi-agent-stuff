# pi-agent-stuff

Personal Pi package with utility extensions, reusable prompts and skills, and an upstream-backed subagents setup.

## What this package includes

- `notify-finished` — notifications for long-running prompts
- `session-changed-files` — track files changed during a Pi session
- upstream `pi-interactive-subagents` — subagents, `/plan`, `/iterate`, `/subagent`, and session artifacts
- local subagent model/thinking overrides — repo-managed policy for which model each agent uses

## How subagents work here

This repo no longer carries its own subagents implementation.

Instead, it loads:
- `pi-interactive-subagents/pi-extension/subagents`
- `pi-interactive-subagents/pi-extension/session-artifacts`

from `node_modules/`, then applies local runtime overrides from:
- `config/subagent-model-overrides.json`

That means:
- upstream prompt and workflow changes flow through package updates
- this repo controls only model and thinking choices
- agent prompts are not copied or shadowed locally

## Current subagent model policy

| Agent | Model | Thinking |
|---|---|---|
| `planner` | `openai-codex/gpt-5.4` | `high` |
| `scout` | `openai-codex/gpt-5.4-mini` | `minimal` |
| `worker` | `openai-codex/gpt-5.4` | `medium` |
| `reviewer` | `openai-codex/gpt-5.4` | `high` |
| `visual-tester` | `openai-codex/gpt-5.4` | `low` |

## Install for local development

First install the npm dependency used by this package:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm install
```

Then install the repo as a local Pi package:

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

## How to update the upstream subagents package

This repo consumes upstream through the npm dependency in `package.json`, not through a direct Pi install.

Update flow:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update pi-interactive-subagents
npm test
```

Then reload or reinstall the repo package:

```text
/reload
```

or:

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

If you want to pin a specific upstream ref, change the dependency in `package.json`, run `npm install`, and commit both `package.json` and `package-lock.json`.

For one-off testing without changing Pi settings:

```bash
pi -e /home/ashalom/Github/pi-agent-stuff
```

## Multiplexer support

The upstream subagents package supports:
- `cmux`
- `tmux`
- `zellij`

Examples:

```bash
cmux pi
# or
TMUX= tmux new -A -s pi 'pi'
# or
zellij --session pi
```

Optional:

```bash
export PI_SUBAGENT_MUX=tmux
```

## Files to know

- `package.json` — package manifest and extension wiring
- `config/subagent-model-overrides.json` — repo-managed per-agent model/thinking config
- `pi-extension/subagent-model-overrides/index.ts` — runtime override extension
- `docs/install.md` — install notes
- `docs/local-development.md` — local workflow
- `docs/repo-layout.md` — package structure
- `docs/tmux-subagents-usage.md` — usage notes for the upstream package in this repo

## Notes

- If you also install `pi-interactive-subagents` directly in Pi, you may load duplicate subagent extensions. Prefer one integration path.
- If you edit `config/subagent-model-overrides.json`, reload Pi with `/reload`.
