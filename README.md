# pi-agent-stuff

Personal Pi package that I use as the portable source of truth for my Pi setup across devices.

## What it loads

### Local resources from this repo
- `pi-extension/answer` — local `/answer` replacement with repo-managed config and upstream-matching UX
- `pi-extension/diff-review` — local `/diff-review` replacement with a browser-based review UI
- `pi-extension/notify-finished` — notifications for long-running prompts
- `pi-extension/session-changed-files` — track files changed during a Pi session
- `pi-extension/subagent-model-overrides` — apply local model/thinking policy to subagents
- `skills/` and `prompts/` — local reusable Pi resources

### Selected upstream resources loaded through `node_modules`
- from `mitsupi`
  - `pi-extensions/todos.ts`
  - `pi-extensions/files.ts`
  - `skills/uv/SKILL.md`
- from `pi-interactive-subagents`
  - `pi-extension/subagents`
  - `pi-extension/session-artifacts`

The idea is simple: this repo curates which upstream Pi resources get loaded, while keeping a small number of local replacements when repo-specific behavior is needed.

## Install

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm install
pi install /home/ashalom/Github/pi-agent-stuff
```

Then reload Pi:

```text
/reload
```

For one-off testing without changing Pi settings:

```bash
pi -e /home/ashalom/Github/pi-agent-stuff
```

## How to use this repo

- Edit this repo, not `~/.pi/agent/extensions/`
- Commit both `package.json` and `package-lock.json` when dependency versions change
- On another device, clone the repo, run `npm install`, then `pi install /path/to/pi-agent-stuff`

### Adding more resources from an upstream package

If you want another extension, skill, prompt, or theme from a dependency such as `mitsupi`, add its path to the `pi` section in `package.json`, then run `npm install` and `/reload`.

Example:

```json
{
  "pi": {
    "extensions": [
      "./pi-extension/answer/index.ts",
      "./node_modules/mitsupi/extensions/todos.ts",
      "./node_modules/mitsupi/extensions/files.ts",
      "./node_modules/mitsupi/extensions/<another-extension>.ts"
    ]
  }
}
```

Use this repo to curate what gets loaded. Do not also install the same upstream package separately in Pi, or you may load the same resource twice.

## Updating upstream packages

Update only what this repo depends on:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update mitsupi pi-interactive-subagents
npm test
```

Then reload or reinstall the package:

```text
/reload
```

or:

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

## Avoid duplicate loading

If this repo is the source of truth, do **not** also install these separately in Pi:
- `npm:mitsupi`
- `pi-interactive-subagents`

Otherwise the same extensions may load twice.

## Subagents in this repo

Subagent behavior comes from upstream `pi-interactive-subagents`. This repo only controls model and thinking defaults through:

- `config/subagent-model-overrides.json`

### `/diff-review`

`/diff-review` opens a local browser review session for the current repo.

Key behavior:
- loopback-only URL on `127.0.0.1` with a per-review secret in the query string
- session-scoped review state that is ephemeral and kept in memory
- same-session + same-repo reuse; changing repos creates a different review session
- working tree vs `HEAD` as the default comparison, with merge-base fallback surfaced in the UI when available mode selection falls back

Frontend build workflow:
- `npm run build:diff-review-web` — rebuild committed static assets in `pi-extension/diff-review/static/`
- `npm run verify:diff-review-web` — rebuild into a temp directory and fail if committed static assets are stale

### `/answer` config

`/answer` is implemented locally in this repo so its extraction source and model priority can be configured without editing TypeScript.

Config file:
- `config/answer.json`

Default config:
- source: `last-assistant`
- model priority:
  1. `github-copilot/gpt-5.4-mini`
  2. `openai-codex/gpt-5.4-mini`
  3. fallback to the current model
- thinking level: `low`

Optional override:
- `thinkingLevel` in `config/answer.json` (`off`, `minimal`, `low`, `medium`, `high`, or `xhigh`)

Current policy:

| Agent | Model | Thinking |
|---|---|---|
| `planner` | `openai-codex/gpt-5.4` | `high` |
| `scout` | `openai-codex/gpt-5.4-mini` | `minimal` |
| `worker` | `openai-codex/gpt-5.4` | `medium` |
| `reviewer` | `openai-codex/gpt-5.4` | `high` |
| `visual-tester` | `openai-codex/gpt-5.4` | `low` |

## Multiplexer support

The upstream subagents package supports:
- `cmux`
- `tmux`
- `zellij`

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
