# Repo layout

## Stable package surface

- `pi-extension/answer/` — local `/answer` replacement with configurable source/model selection
- `pi-extension/diff-review/` — local browser-based diff review workflow
- `pi-extension/herdr-subagents/` — Herdr-native persistent Pi child orchestration
  - `agents/` — adapted Explorer, Planner, Worker, and Reviewer definitions
  - `herdr.ts` — typed Herdr CLI adapter
  - `monitor.ts` — lifecycle and follow-up queue state machine
  - `session-reader.ts` — incremental child JSONL extraction
  - `delivery.ts` — parent result coalescing and rendering
  - `ui.ts` — tools and `/subagent`
- `pi-extension/notify-finished/` — long-running prompt notifications
- `pi-extension/session-changed-files/` — per-session changed-file tracking
- `config/answer.json` — repo-managed `/answer` behavior
- `config/subagent-model-overrides.json` — repo-managed per-role model/thinking policy
- `skills/` — reusable Pi skills
- `prompts/` — reusable prompt templates
  - `cleanup-subagents.md` — close finished, extension-tagged Herdr subagent panes
  - `review.md` — parallel Standards and Requirements reviewers sharing one Hunk session
- `docs/` — project docs and design notes
- `examples/` — sample config and usage notes
- `test/` — automated tests, including fake-Herdr subagent lifecycle coverage

## Upstream resources loaded through this package

The package currently loads selected todo/file extensions and the UV skill from `mitsupi`. Subagent prompts and orchestration are implemented locally rather than loaded from `pi-interactive-subagents`.

## Ownership boundary

Herdr owns terminal topology, navigation, labels, and coarse lifecycle state. Pi child session JSONL is authoritative for exact assistant responses. The parent extension owns only children launched by its current in-memory runtime.

## Experimental area

- `experimental/` — draft skills, prompts, and agents tracked in git but excluded from the package manifest
