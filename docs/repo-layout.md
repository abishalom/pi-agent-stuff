# Repo layout

## Stable package surface
- `pi-extension/` — stable extension entrypoints and helper modules
- `agents/` — bundled agent definitions used by tmux subagents work
- `skills/` — reusable Pi skills
- `prompts/` — reusable prompt templates
- `docs/` — project docs and design notes
- `examples/` — sample config and override examples
- `test/` — tests

## Experimental area
- `experimental/` — draft skills, prompts, and agents tracked in git but excluded from the package manifest

## Current migrated files
- `pi-extension/notify-finished/index.ts`
- `pi-extension/session-changed-files/index.ts`
- `docs/tmux-subagents-plan.md`
- `docs/tmux-subagents-technical-spec.md`

## Planned additions
- `pi-extension/subagents/`
- `pi-extension/session-artifacts/`
- bundled subagent agent files under `agents/`
