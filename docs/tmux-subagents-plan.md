# Pi tmux Subagents Plan

## Objective
Build a new Pi package for Linux shells, including WSL, that reproduces the UX and workflow of `pi-interactive-subagents` while replacing `cmux` with `tmux`.

The package should preserve:
- `/plan`
- `/iterate`
- `/subagent`
- the bundled agent roles: `planner`, `scout`, `worker`, `reviewer`, `visual-tester`
- interactive side-by-side subagent sessions
- resumable subagent sessions
- artifact support
- the original planning → execution → review flow

The package does not need to preserve cmux-specific abstractions such as surfaces or workspaces.

## Scope
### In scope
- New package, not a fork
- Linux/WSL-first design
- Hard `tmux` requirement in v1
- Mostly API-compatible tools
- Same command surface as the original package
- JSON operational config
- Markdown agent definitions with frontmatter
- Project/global agent overrides
- Durable subagent registry
- Session artifact support
- Integration with the existing todo plugin
- Nested subagents with configurable guardrails

### Out of scope for v1
- Windows Terminal as the control plane
- `cmux` compatibility
- Detached/background orchestration semantics
- Full workflow DSL
- Cross-tmux-session orchestration
- Parallel worker execution in `/plan`

## Runtime model
- Pi must run inside an attached `tmux` session.
- `tmux` must be installed and available on PATH.
- A persistent Pi session file is required.
- If prerequisites are missing, tools fail with a clear message explaining how to start Pi inside tmux.

## Compatibility target
### Preserve
- Commands: `/plan`, `/iterate`, `/subagent`
- Tools: `subagent`, `subagent_resume`, `subagents_list`
- `subagent` parameter surface: `name`, `task`, `agent`, `interactive`, `fork`, `model`, `systemPrompt`, `skills`, `tools`
- Agent discovery order:
  1. `.pi/agents/`
  2. `~/.pi/agent/agents/`
  3. bundled defaults
- `/iterate` full-context fork semantics
- `/plan` default phase flow
- Resume behavior: always reopen in a new interactive target

### Reinterpret for tmux
- Terminal management
- Title/progress behavior
- Completion detection backend
- Internal state and registry model

## tmux model
To match the original package closely, both interactive and autonomous subagents should use split panes by default.

### Default behavior
- New subagent target: tmux split pane
- Default split direction: `right`
- Configurable split direction: `right` or `bottom`
- Interactive targets take focus automatically
- Panes auto-close by default on completion
- Auto-close can be disabled in config

### Completion model
- Pi command appends a sentinel such as `__SUBAGENT_DONE_<exitcode>__`
- Backend polls pane output via tmux capture
- Semantic summary comes from the Pi session file

## Architecture
### 1. Orchestration layer
Responsible for:
- tool and command registration
- workflow sequencing
- lifecycle management
- summary extraction
- resume behavior
- guardrail enforcement

### 2. tmux backend
Responsible for:
- tmux prerequisite checks
- split creation
- focus management
- command dispatch
- pane capture
- completion polling
- window/pane title updates
- pane close

### 3. Config and agent loading
Responsible for:
- JSON settings resolution
- Markdown agent loading
- frontmatter parsing
- precedence rules
- extension allowlist/denylist filtering

### 4. State and registry
Responsible for:
- durable subagent records
- parent/child links
- active-subagent tracking
- nesting depth enforcement
- resume metadata
- stale-state recovery

### 5. Artifact layer
Responsible for:
- writing artifacts
- reading artifacts
- session-scoped plans/context/notes
- integration with the existing todo plugin

## Workflow behavior
### `/plan`
Preserve the original default workflow:
1. quick investigation in main session
2. interactive planner subagent
3. review plan and todos in main session
4. scout then sequential workers
5. reviewer pass
6. fix critical findings if needed

Notes:
- `/plan` remains sequential for workers
- the broader system may still allow multiple subagents when needed

### `/iterate`
Preserve the original semantics:
- fork current session
- copy full conversation context
- open interactive split pane
- user exits with `Ctrl+D`
- main session receives summary

### `/subagent`
Preserve direct spawn semantics:
- named display name
- optional agent defaults
- interactive/autonomous modes
- optional overrides
- optional `fork`

## State model
Each spawned subagent should have a durable record with at least:
- internal id
- display name
- agent name
- parent id
- nesting depth
- interactive flag
- fork flag
- task preview
- Pi session path
- tmux session id
- tmux window id
- tmux pane id
- status
- created/started/completed timestamps
- exit code
- summary preview
- resume count or lineage metadata

Identity rules:
- use an opaque internal id for durable tracking
- do not rely on display names for uniqueness
- allow repeated visible names or repeated agent types

## Configuration model
### Operational settings (JSON)
Recommended precedence:
1. project-local config
2. global config
3. bundled defaults

Recommended paths:
- project: `.pi/subagents.json`
- global: `~/.pi/agent/subagents.json`

Suggested settings:
- split direction
- auto-close behavior
- max nesting depth
- max active subagents
- extension allowlist/denylist
- `/plan` phase toggles
- title update policy

### Agent definitions (Markdown)
Discovery order remains:
1. `.pi/agents/`
2. `~/.pi/agent/agents/`
3. bundled defaults

Bundled defaults:
- `planner`
- `scout`
- `worker`
- `reviewer`
- `visual-tester`

## Resume behavior
`subagent_resume` should:
- reopen the given Pi session file in a new interactive split pane
- optionally send a follow-up message
- wait for completion
- return a summary from new session entries

It should not try to infer or focus an already-running matching subagent in v1.

## Error handling
Clear failures for:
- tmux missing
- Pi not running inside tmux
- no persistent session file
- pane creation failure
- command dispatch failure
- session file missing
- summary extraction failure
- cancellation/interruption

Registry statuses should include:
- running
- completed
- failed
- cancelled
- stale

## Suggested package layout
- `package.json`
- `README.md`
- `pi-extension/subagents/index.ts`
- `pi-extension/subagents/tmux.ts`
- `pi-extension/subagents/session.ts`
- `pi-extension/subagents/registry.ts`
- `pi-extension/subagents/config.ts`
- `pi-extension/subagents/agents.ts`
- `pi-extension/subagents/subagent-done.ts`
- `pi-extension/subagents/plan-skill.md`
- `pi-extension/session-artifacts/index.ts`
- `agents/planner.md`
- `agents/scout.md`
- `agents/worker.md`
- `agents/reviewer.md`
- `agents/visual-tester.md`

## Implementation phases
### Phase 1: parity foundation
Build:
- tmux backend
- direct subagent spawn
- summary extraction
- resume
- list agents
- prerequisite errors

### Phase 2: workflow parity
Build:
- `/iterate`
- `/plan`
- planner/scout/worker/reviewer orchestration
- artifact tools
- todo integration

### Phase 3: policy and robustness
Build:
- JSON config
- durable registry/state
- guardrails
- stale-state recovery
- extension allowlist/denylist
- auto-close settings

### Phase 4: polish
Build:
- progress rendering
- title updates
- clearer resume output
- docs
- test coverage for failure and tmux edge cases

## Success criteria
- User can run Pi inside tmux on WSL or Linux and use `/subagent`, `/iterate`, and `/plan`.
- Interactive subagents appear in a side-by-side pane.
- Autonomous subagents also run in panes, matching the original package.
- Session summaries and resume hints are returned correctly.
- Agent overrides work from project and global directories.
- Guardrails prevent runaway nesting or excessive active subagents.
- Artifacts and todos support the full planning workflow.
