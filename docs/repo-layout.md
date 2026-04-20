# Repo layout

## Stable package surface

- `pi-extension/answer/` — local `/answer` replacement with configurable source/model selection
- `pi-extension/notify-finished/` — long-running prompt notifications
- `pi-extension/session-changed-files/` — per-session changed-file tracking
- `pi-extension/subagent-model-overrides/` — runtime model/thinking overrides for upstream subagents
- `config/answer.json` — repo-managed `/answer` behavior
- `config/subagent-model-overrides.json` — repo-managed per-agent model/thinking policy
- `skills/` — reusable Pi skills
- `prompts/` — reusable prompt templates
- `docs/` — project docs and design notes
- `examples/` — sample config and usage notes
- `test/` — automated tests

## Upstream resources loaded through this package

These are not implemented in this repo anymore. They are loaded from `node_modules/pi-interactive-subagents/`:

- subagents extension
- session-artifacts extension
- bundled agent prompts

## Why the split exists

The upstream package owns:
- agent prompts
- orchestration behavior
- multiplexer integration
- subagent tools and commands

This repo owns:
- local utility extensions
- model/thinking policy for subagents
- package-level docs and examples

## Experimental area

- `experimental/` — draft skills, prompts, and agents tracked in git but excluded from the package manifest
