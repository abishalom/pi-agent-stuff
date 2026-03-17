# pi-agent-stuff

Personal Pi package for reusable extensions, skills, prompts, and tmux subagents work.

## What is in this repo

### Stable package-managed resources
- `pi-extension/notify-finished` — long-running prompt notifications
- `pi-extension/session-changed-files` — track files changed during a Pi session
- `skills/` — personal reusable Pi skills
- `prompts/` — reusable prompt templates
- `agents/` — bundled agent definitions for tmux subagents work

### Planned / in progress
- `pi-extension/subagents/` — tmux-based interactive subagents package
- `pi-extension/session-artifacts/` — artifact helpers for planning/execution workflows

### Not shipped by default
- `experimental/` — WIP skills, prompts, and agents kept in git but excluded from the package manifest

## Repo layout
- `pi-extension/` — extension source
- `agents/` — bundled subagent role definitions
- `skills/` — reusable Pi skills
- `prompts/` — prompt templates
- `docs/` — design notes, install notes, and local development workflow
- `examples/` — sample config and override examples
- `experimental/` — draft resources not included in the default install surface
- `test/` — tests

## Local development workflow

The repo is the source of truth.

1. Edit files in `~/Github/pi_agent_stuff`
2. Load the package locally in Pi
3. Use `/reload` after changes
4. Once the package-managed versions work, remove or disable duplicate global copies from `~/.pi/agent/extensions/`

See `docs/local-development.md` for the exact workflow.

## Install for local development

Use the repo as a local Pi package:

```bash
pi install /home/ashalom/Github/pi_agent_stuff
```

Or test it for one run only:

```bash
pi -e /home/ashalom/Github/pi-agent-stuff
```

## Install from git later

After pushing to GitHub, install via git:

```bash
pi install git:github.com/<your-user>/pi-agent-stuff
```

## Current package manifest

Right now the package exposes these stable extensions:
- `notify-finished`
- `session-changed-files`

The tmux subagents code is scaffolded in the repo structure but is not yet part of the package manifest until it exists.

## Docs
- `docs/local-development.md`
- `docs/install.md`
- `docs/repo-layout.md`
- `docs/tmux-subagents-plan.md`
- `docs/tmux-subagents-technical-spec.md`
