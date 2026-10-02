# pi-agent-stuff

Personal Pi package that I use as the portable source of truth for my Pi setup across devices.

## What it loads

### Local resources from this repo
- `pi-extension/answer` — local `/answer` replacement with repo-managed config and upstream-matching UX
- `pi-extension/notify-finished` — notifications for long-running prompts
- `pi-extension/session-changed-files` — track files changed during a Pi session
- `pi-extension/herdr-subagents` — persistent interactive Pi children hosted natively by Herdr
- `pi-extension/leaf-preview` — opens the latest assistant response in Leaf in a temporary Herdr split
- `prompts/review.md` — parallel standards/requirements review in a shared Hunk session
- `prompts/cleanup-subagents.md` — close finished, role-tagged Herdr subagent panes
- `skills/` and `prompts/` — local reusable Pi resources

### Bundled resources adapted from `mitsupi`
- `pi-extension/mitsupi/todos.ts`
- `pi-extension/mitsupi/files.ts`
- `skills/uv/SKILL.md`

These resources are bundled locally and use the current `@earendil-works/pi-*` packages. This avoids installing `mitsupi`'s obsolete `@mariozechner/pi-*` peer dependencies and their deprecation warnings.

## Install

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm install --ignore-scripts
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
- On another device, clone the repo, run `npm install --ignore-scripts`, then `pi install /path/to/pi-agent-stuff`

### Adding more resources

Add local extensions, skills, prompts, or themes to the corresponding repo directory and register their paths in the `pi` section of `package.json`. Then run `npm install --ignore-scripts` and `/reload`.

Use this repo to curate what gets loaded. Do not also install the same resource separately in Pi, or it may be loaded twice.

## Updating dependencies

Pi supplies `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` at runtime. Declare any of these that this package uses as `"*"` peer dependencies, never as runtime dependencies. Development copies belong in `devDependencies` for local tests; the Pi development dependencies here target 1.0.0.

`npm update` stays within the declared version ranges. When upgrading Pi across a major or minor version, update the Pi development dependency ranges too, then install and test.

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update --ignore-scripts
npm run typecheck
npm test
```

`npm run typecheck` strictly checks supported `pi-extension/**/*.ts` source and TypeScript config tooling under `config/`; experimental artifacts and tests are excluded. Host declaration files are skipped (`skipLibCheck`), but extension usage of their APIs is checked. `npm test` includes a real Pi extension-loader smoke test for all nine manifest entries.

Pi 1.0.0's published `npm-shrinkwrap.json` pins `brace-expansion` to 5.0.9 under its development dependency tree. `npm audit` currently reports one high-severity package (three DoS advisories); the patched release is 5.0.12. A normal audit fix/update and root override do not supersede that published shrinkwrap. Await an upstream Pi release rather than force-upgrading or modifying installed host files.

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

`pi-extension/herdr-subagents` launches persistent Pi children in background Herdr tabs by default, with an explicit split override. Use `/subagent`, the `subagent` tool, `subagent_followup`, `subagent_interrupt`, `subagent_compact`, `subagent_status`, `get_subagent_result`, and `subagents_list`. Exact responses and hook-reported compaction success/failure/cancellation outcomes are extracted from child session JSONL and relayed to the parent. Compaction submission remains asynchronous; finish the parent turn to wait for its notification without polling.

Role definitions live in `pi-extension/herdr-subagents/agents/`; model/thinking policy lives in `config/subagent-model-overrides.json`. See `docs/2026-07-15-herdr-subagents-usage.md`.

| Agent | Model | Thinking |
|---|---|---|
| `explorer` | `openai-codex/gpt-6-luna` | `low` |
| `planner` | `openai-codex/gpt-6.1-sol` | `high` |
| `worker` | `openai-codex/gpt-6.1-sol` | `medium` |
| `reviewer` | `openai-codex/gpt-6.1-sol` | `high` |

### `/cleanup-subagents`

`/cleanup-subagents` closes only idle or done Herdr subagent panes tagged by this extension with `tokens.role`. It leaves active, blocked, unknown, untagged, focused, and out-of-workspace panes alone.

### `/review`

`/review [spec path or instructions]` reviews the uncommitted working tree along two independent axes. It discovers repository standards and requirements, asks before proceeding when either source is missing or ambiguous, prepares one shared Hunk session, and launches separate Standards and Requirements reviewer subagents. Their tagged Hunk findings are aggregated under separate headings after both finish.

### `/answer` config

`/answer` is implemented locally in this repo so its extraction source and model priority can be configured without editing TypeScript.

Config file:
- `config/answer.json`

Default config:
- source: `last-assistant`
- model priority:
  1. `openai-codex/gpt-6-luna`
  2. fallback to the current model when Codex Luna is absent or unauthenticated
- thinking level: `low`

GPT-6 Luna is available on OpenAI Codex starting with Pi 0.87.1 and replaces the previous GPT-5.4 mini preferences (Codex mini was removed in 0.86.0). OpenAI Codex is the only default extraction provider. No provider or authentication migration is required. Current-model fallback retains the session's model (and its pricing); set `fallbackToCurrentModel` to `false` to require a configured extraction model.

Optional overrides:
- `modelPriority`: ordered `{ "provider": "…", "model": "…" }` candidates from your available Pi catalog; the first found, authenticated model is used.
- `fallbackToCurrentModel`: whether to use the session's current model if no candidate is usable (default `true`).
- `thinkingLevel` in `config/answer.json` (`off`, `minimal`, `low`, `medium`, `high`, or `xhigh`)

## Multiplexer support

Herdr is the only v1 subagent backend. Start Pi from a Herdr-managed pane and keep the Pi integration current:

```bash
herdr
# run pi inside the Herdr pane
herdr integration install pi
```

The extension rejects launches outside the Pi TUI or outside Herdr. Direct non-subagent Pi usage is unaffected.

## `/leaf`

`/leaf [right|down]` writes the latest complete assistant response to a private temporary Markdown file and opens it in Leaf in a focused Herdr split (`right` is the default). A new `/leaf` closes the prior preview split first. Quit Leaf with `q`; its shell exits, the preview split closes, and the temporary file is removed. This command requires Pi to run in a Herdr pane and Leaf to be on `PATH`.
