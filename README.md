# pi-agent-stuff

Personal Pi package that I use as the portable source of truth for my Pi setup across devices.

## What it loads

### Local resources from this repo
- `pi-extension/answer` — local `/answer` replacement with repo-managed config and upstream-matching UX
- `pi-extension/diff-review` — local `/diff-review` replacement with a browser-based review UI
- `pi-extension/notify-finished` — notifications for long-running prompts
- `pi-extension/session-changed-files` — track files changed during a Pi session
- `pi-extension/herdr-subagents` — persistent interactive Pi children hosted natively by Herdr
- `prompts/review.md` — parallel standards/requirements review in a shared Hunk session
- `skills/` and `prompts/` — local reusable Pi resources

### Bundled resources adapted from `mitsupi`
- `pi-extension/mitsupi/todos.ts`
- `pi-extension/mitsupi/files.ts`
- `skills/uv/SKILL.md`

These resources are bundled locally and use the current `@earendil-works/pi-*` packages. This avoids installing `mitsupi`'s obsolete `@mariozechner/pi-*` peer dependencies and their deprecation warnings.

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

### Adding more resources

Add local extensions, skills, prompts, or themes to the corresponding repo directory and register their paths in the `pi` section of `package.json`. Then run `npm install` and `/reload`.

Use this repo to curate what gets loaded. Do not also install the same resource separately in Pi, or it may be loaded twice.

## Updating dependencies

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update
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

If this repo is the source of truth, do **not** install a second copy of these bundled resources separately in Pi. Do not install the removed `pi-interactive-subagents` package alongside this package, because it registers conflicting subagent tools and commands.

## Subagents in this repo

`pi-extension/herdr-subagents` launches persistent Pi children in background Herdr tabs by default, with an explicit split override. Use `/subagent`, the `subagent` tool, `subagent_followup`, `subagent_interrupt`, `get_subagent_result`, and `subagents_list`. Exact responses are extracted from child session JSONL and relayed to the parent.

Role definitions live in `pi-extension/herdr-subagents/agents/`; model/thinking policy lives in `config/subagent-model-overrides.json`. See `docs/2026-07-15-herdr-subagents-usage.md`.

| Agent | Model | Thinking |
|---|---|---|
| `explorer` | `openai-codex/gpt-5.6-luna` | `low` |
| `planner` | `openai-codex/gpt-5.6-sol` | `high` |
| `worker` | `openai-codex/gpt-5.6-terra` | `medium` |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `high` |

### `/review`

`/review [spec path or instructions]` reviews the uncommitted working tree along two independent axes. It discovers repository standards and requirements, asks before proceeding when either source is missing or ambiguous, prepares one shared Hunk session, and launches separate Standards and Requirements reviewer subagents. Their tagged Hunk findings are aggregated under separate headings after both finish.

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

## Multiplexer support

Herdr is the only v1 subagent backend. Start Pi from a Herdr-managed pane and keep the Pi integration current:

```bash
herdr
# run pi inside the Herdr pane
herdr integration install pi
```

The extension rejects launches outside the Pi TUI or outside Herdr. Direct non-subagent Pi usage is unaffected.
