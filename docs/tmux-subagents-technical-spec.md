# Pi tmux Subagents Technical Specification

## 1. Overview
This document specifies a new Pi package that reproduces the workflow of `pi-interactive-subagents` on Linux and WSL by replacing `cmux` with `tmux`.

The package is compatibility-oriented, not source-compatible. It keeps the original command and workflow model where practical, but adopts tmux-native internals.

## 2. Design principles
- Preserve workflow, not cmux vocabulary.
- Keep v1 deterministic and easy to debug.
- Treat tmux as the control plane and Pi session files as the source of truth for summaries.
- Keep configuration simple: JSON for operations, Markdown for agents.
- Prefer explicit state over inference.
- Match the original package by default; diverge only where tmux requires or where clarity improves.

## 3. Functional requirements
### 3.1 Commands
The package must register:
- `/plan`
- `/iterate`
- `/subagent <agent> <task>`

### 3.2 Tools
The package must register:
- `subagent`
- `subagent_resume`
- `subagents_list`
- `write_artifact`
- `read_artifact`

### 3.3 `subagent` tool
Required parameters and semantics:
- `name: string` — display name for the spawned subagent
- `task: string` — task prompt
- `agent?: string` — agent definition name
- `interactive?: boolean` — default `true`
- `fork?: boolean` — default `false`; copies current session for full context
- `model?: string` — explicit model override
- `systemPrompt?: string` — explicit prompt override or append behavior, depending on final implementation choice
- `skills?: string` — comma-separated skills override
- `tools?: string` — comma-separated built-in tools override

Behavior:
- validate tmux availability and attached session
- validate persistent Pi session
- load agent defaults if specified
- merge explicit overrides over agent defaults
- create a tmux target
- start Pi in that target
- monitor until completion
- read summary from the resulting Pi session
- return summary plus resume reference

### 3.4 `subagent_resume` tool
Parameters:
- `sessionPath: string`
- `name?: string`
- `message?: string`

Behavior:
- validate session path exists
- open a new interactive split pane
- run `pi --session <sessionPath>`
- optionally send follow-up message
- wait for completion
- return summary from new entries only

### 3.5 `subagents_list` tool
Behavior:
- discover agent definitions from project, global, bundled paths
- project overrides global; global overrides bundled
- return merged list with source metadata

### 3.6 Artifact tools
#### `write_artifact`
Behavior:
- write named content into session-scoped or workflow-scoped storage
- support plain text and markdown content
- return path and metadata

#### `read_artifact`
Behavior:
- read current or previous artifact by name/path
- return content and path metadata

## 4. Non-functional requirements
- Linux shell compatible
- WSL compatible
- no dependency on macOS-only terminal features
- deterministic behavior under nested subagent usage
- clear prerequisite failures
- durable subagent tracking across process interruption
- no silent state loss

## 5. System model
The system has three sources of truth:

### 5.1 tmux target metadata
Used for:
- pane control
- focus
- output capture
- close operations

### 5.2 Pi session files
Used for:
- semantic output
- final summary extraction
- resume continuation

### 5.3 Package registry state
Used for:
- lifecycle state
- parent/child relationship tracking
- nesting limits
- recovery

## 6. Configuration specification
### 6.1 Config paths
Project config:
- `.pi/subagents.json`

Global config:
- `~/.pi/agent/subagents.json`

### 6.2 Precedence
1. explicit tool parameters
2. project config
3. global config
4. package defaults
5. bundled agent defaults where relevant

### 6.3 Suggested config schema
```json
{
  "backend": "tmux",
  "layout": {
    "defaultSplit": "right",
    "interactiveFocus": true,
    "autoClose": true,
    "setPaneTitle": true,
    "renameWindow": true
  },
  "limits": {
    "maxNestingDepth": 3,
    "maxActiveSubagents": 6
  },
  "plan": {
    "enableScout": true,
    "enableReviewer": true,
    "sequentialWorkers": true,
    "autoFixCriticalReviewFindings": true
  },
  "extensions": {
    "mode": "allow-all",
    "allow": [],
    "deny": []
  }
}
```

### 6.4 Validation rules
- `backend` must be `tmux` in v1
- `defaultSplit` must be `right` or `bottom`
- `maxNestingDepth` must be >= 1
- `maxActiveSubagents` must be >= 1
- `extensions.mode` must be one of `allow-all`, `allowlist`, `denylist`

## 7. Agent definition specification
### 7.1 Discovery paths
1. `.pi/agents/*.md`
2. `~/.pi/agent/agents/*.md`
3. bundled `agents/*.md`

### 7.2 Frontmatter fields
Supported fields:
- `name`
- `description`
- `model`
- `thinking`
- `tools`
- `skills`

### 7.3 Merge rules
- first discovered file by precedence wins for that agent name
- explicit tool call parameters override frontmatter
- body content becomes the agent identity/system prompt text

### 7.4 Bundled agents
The package should include:
- `planner`
- `scout`
- `worker`
- `reviewer`
- `visual-tester`

Best practice:
- keep bundled prompts close to the original package initially
- document that users should override via project/global agent files rather than editing package files directly

## 8. Registry specification
### 8.1 Storage paths
Suggested project-local paths:
- `.pi/subagents/registry.json`
- `.pi/subagents/runs/<id>.json`

### 8.2 Registry record schema
```json
{
  "id": "suba_01abc...",
  "displayName": "💬 Planner",
  "agent": "planner",
  "parentId": null,
  "rootSessionPath": "/path/to/root.jsonl",
  "sessionPath": "/path/to/subagent.jsonl",
  "interactive": true,
  "fork": false,
  "nestingDepth": 1,
  "status": "running",
  "taskPreview": "Plan dark mode support",
  "tmux": {
    "sessionName": "pi",
    "windowId": "@4",
    "paneId": "%12"
  },
  "timing": {
    "createdAt": "2026-03-17T00:00:00Z",
    "startedAt": "2026-03-17T00:00:01Z",
    "completedAt": null
  },
  "exitCode": null,
  "summaryPreview": null,
  "resumeCount": 0
}
```

### 8.3 Status values
- `starting`
- `running`
- `completed`
- `failed`
- `cancelled`
- `stale`

### 8.4 Recovery rules
On package startup or command invocation:
- load registry
- inspect records marked `starting` or `running`
- verify tmux target still exists
- verify session file still exists
- if not, mark as `stale`

Best practice:
- never delete running records automatically without inspection
- prefer state transitions over deletion

## 9. tmux backend specification
### 9.1 Availability check
Must verify:
- `tmux` executable exists
- `TMUX` env var is present
- current pane/session is addressable

### 9.2 Target creation
#### Interactive or autonomous v1 default
Create a split pane in the current tmux session.

Suggested commands:
- `tmux split-window -h -P -F '#{pane_id} #{window_id}'`
- or vertical equivalent for bottom split

Design requirement:
- return structured target metadata, not raw command output strings

### 9.3 Focus behavior
- interactive targets: focus automatically
- autonomous targets: default should follow original behavior closely; implementation should still be explicit and testable

### 9.4 Sending commands
Use `tmux send-keys` with Enter.
Do not rely on shell history or manual typing assumptions.

### 9.5 Capturing output
Use `tmux capture-pane` or equivalent to inspect recent lines.
The backend should support a configurable number of lines to read.

### 9.6 Closing targets
Use pane-targeted kill/close commands.
Only close automatically if configured.

### 9.7 Titles
Use tmux-native title behavior:
- rename window when showing progress
- optionally set pane title

Best practice:
- treat title updates as cosmetic; do not encode logic in them

## 10. Session and execution specification
### 10.1 Fresh session mode
If `fork` is false:
- launch new Pi session in the current session directory
- identify the new session file created after spawn

### 10.2 Fork mode
If `fork` is true:
- copy the current session file
- use copied file as the subagent session

### 10.3 Task injection
Use temp files for large prompts and pass them via `@file` syntax.
This avoids command-line and terminal-input truncation.

### 10.4 Skill injection
Inject skills as separate command messages where needed.
Preserve visible skill invocation behavior when practical.

### 10.5 Completion sentinel
Append a shell-safe sentinel after the Pi process exits.
The backend must parse the exit code from sentinel text.

Best practice:
- isolate all shell quoting in one helper module
- support fish/bash differences only if truly needed in your Linux target matrix

## 11. Workflow specification
### 11.1 `/plan`
Phases:
1. quick investigation
2. interactive planner
3. review plan and todos
4. scout context gathering
5. sequential worker execution
6. reviewer pass
7. optional fixes for critical findings

Requirements:
- workers remain sequential in `/plan`
- use artifacts for plan/context persistence
- use todo plugin for task execution tracking

### 11.2 `/iterate`
Requirements:
- always fork session
- always open interactive split pane
- full current context available in child session
- summary returned on exit

### 11.3 Direct `/subagent`
Requirements:
- support both interactive and autonomous modes
- allow nested spawns
- enforce configured limits

## 12. Guardrails
### 12.1 Limits
Enforce configurable:
- max nesting depth
- max active subagents

### 12.2 Enforcement timing
Check before target creation.
Failure should be user-visible and explain which limit was reached.

### 12.3 Parallelism rules
- general subagent parallelism may exist
- `/plan` worker execution remains sequential by default and in v1 behavior

Best practice:
- separate system-wide capability from workflow policy
- do not let a permissive backend quietly change `/plan` semantics

## 13. Error handling specification
### 13.1 Prerequisite errors
Examples:
- tmux not installed
- not inside tmux
- no persistent session file

### 13.2 Launch errors
Examples:
- split-pane creation failed
- send-keys failed
- temp file write failed

### 13.3 Runtime errors
Examples:
- sentinel not found before cancellation
- session file unreadable
- summary missing
- tmux pane vanished unexpectedly

### 13.4 Resume errors
Examples:
- session file missing
- follow-up message injection failed

Best practice:
- error messages should say what failed and what the user can do next
- avoid vague errors such as only `spawn failed`

## 14. Testing strategy
Use a layered test approach.

### 14.1 Unit tests
Test pure logic without requiring a live tmux session.

Coverage should include:
- config loading and precedence
- agent discovery and override rules
- frontmatter parsing
- shell escaping
- task/session file selection logic
- registry state transitions
- guardrail checks
- summary extraction from session entries
- resume delta extraction

Example unit cases:
1. project config overrides global config
2. explicit param overrides agent frontmatter
3. project agent overrides bundled agent of same name
4. `fork=true` uses copied session path
5. missing new session file returns fallback summary
6. registry marks vanished running pane as stale
7. max depth exceeded returns a clear error
8. max active count exceeded returns a clear error

### 14.2 Backend command tests
Mock tmux command execution and verify:
- correct split command for `right`
- correct split command for `bottom`
- focus command sent for interactive spawn
- title rename command format
- close command skipped when `autoClose=false`

Example cases:
1. interactive spawn creates pane and focuses it
2. autonomous spawn creates pane and uses same monitoring path
3. resume always creates a new split pane
4. sentinel parser extracts non-zero exit code correctly

### 14.3 Integration tests
Run against a real tmux session where practical.

Coverage should include:
- subagent spawn end-to-end
- summary extraction from real session file
- pane auto-close behavior
- resume flow
- nested spawn within limits
- failure when outside tmux

Example integration cases:
1. running `subagent` inside tmux completes and returns summary
2. running `subagent` outside tmux returns prerequisite error
3. `/iterate` fork produces a separate session file
4. `subagent_resume` returns only new summary output
5. configured bottom split creates expected pane arrangement
6. stale registry record is detected on next invocation

### 14.4 Workflow tests
Exercise orchestrator logic for `/plan` and `/iterate` using stubs where needed.

Coverage should include:
- `/plan` phase ordering
- sequential worker policy
- reviewer execution after workers
- artifact write/read usage in planning flow
- todo integration points

Example workflow cases:
1. `/plan` always runs planner before worker phase
2. `/plan` never launches two workers concurrently in default mode
3. `/plan` reviewer runs after successful worker completion
4. planner artifact path is available to execution phase

## 15. Best practices
### Architecture
- Keep backend operations behind a narrow interface.
- Keep workflow code free of tmux command strings.
- Keep state transitions explicit.

### Reliability
- Write registry changes atomically.
- Record state before and after major lifecycle transitions.
- Prefer idempotent cleanup paths.

### UX
- Keep messages short and actionable.
- Tell the user when to switch panes and how to return.
- Always include resume information when available.

### Prompts and agents
- Keep bundled prompts close to the original at first.
- Let users override prompts through Markdown, not package edits.
- Do not hard-code model ids in orchestration logic if agent files already define them.

### Shell safety
- Centralize quoting and command construction.
- Use temp files for large prompts.
- Avoid embedding untrusted input directly into shell fragments.

### tmux hygiene
- Use pane ids/window ids, not human names, for control.
- Treat renamed titles as display only.
- Expect panes to disappear unexpectedly and handle it cleanly.

### Testing
- Unit test state and config aggressively.
- Keep tmux integration seams narrow so they can be mocked.
- Add at least a small real-tmux integration suite for confidence.

## 16. Recommended implementation order
1. define backend interface and registry schema
2. implement config/agent loading
3. implement tmux backend helpers
4. implement `subagent`
5. implement `subagent_resume`
6. implement `subagents_list`
7. implement artifact tools
8. implement `/iterate`
9. implement `/plan`
10. add guardrails, recovery, and test coverage

## 17. Acceptance criteria
The implementation is complete when:
- Pi running inside tmux can spawn a subagent in a split pane
- the subagent returns a summary and resume hint
- `/iterate` forks full context correctly
- `/plan` completes with planner → workers → reviewer flow
- bundled agent overrides work from `.pi/agents/` and `~/.pi/agent/agents/`
- config overrides work from project/global JSON
- nested spawns are allowed within configured limits
- missing tmux or missing session produces clear errors
- test coverage exists for unit, backend, integration, and workflow behavior
