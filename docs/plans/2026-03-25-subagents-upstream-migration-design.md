# Subagents upstream migration design

Date: 2026-03-25

## Goal

Replace the in-repo tmux subagents implementation with the upstream `HazAT/pi-interactive-subagents` package while keeping repo-managed control over per-agent model and thinking settings.

## Constraints

- Do not change bundled agent prompts for now.
- Only customize model and thinking.
- Keep the setup version-controlled in `pi-agent-stuff`.
- Preserve upstream package updates for prompts and orchestration behavior.

## Chosen approach

Use the upstream package for subagents and session artifacts, then add a small local extension that applies model and thinking overrides at runtime for spawned subagent sessions.

## Why this approach

Using `.pi/agents/*.md` overrides would require copying upstream agent files, which would also freeze prompt content locally. A runtime override extension avoids prompt shadowing and lets upstream prompt changes flow through package updates.

## Design

### Package wiring

`pi-agent-stuff` will:
- keep local utility extensions like `notify-finished` and `session-changed-files`
- load upstream subagent and session-artifact extensions from `node_modules/pi-interactive-subagents/...`
- add a local extension for subagent model/thinking overrides

### Runtime override mechanism

The upstream package launches subagent sessions with environment variables such as:
- `PI_SUBAGENT_AGENT`
- `PI_SUBAGENT_NAME`

The local override extension will:
1. detect whether the current session is a spawned subagent
2. read a repo-local JSON config mapping agent name to model/thinking
3. apply the override on `session_start`
4. re-apply on `before_agent_start` to ensure the first request uses the configured model/thinking

### Config location

Store repo-managed overrides in `config/subagent-model-overrides.json`.

### Initial agent policy

| Agent | Model | Thinking |
|---|---|---|
| planner | `openai-codex/gpt-5.4` | `high` |
| scout | `openai-codex/gpt-5.4-mini` | `minimal` |
| worker | `openai-codex/gpt-5.4` | `medium` |
| reviewer | `openai-codex/gpt-5.4` | `high` |
| visual-tester | `openai-codex/gpt-5.4` | `low` |

## Risks

- If upstream changes how subagent sessions identify themselves, the override extension may need a small compatibility update.
- If a configured model is missing from Pi's model registry, the extension should fail softly and notify the user.

## Verification

- Confirm package manifest loads upstream subagent tools and commands.
- Confirm a spawned subagent session picks up the configured model and thinking level.
- Confirm no local prompt override files shadow upstream bundled agents.

## Update process

To update the upstream package used by this repo:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update pi-interactive-subagents
npm test
```

Then reload Pi or reinstall this repo package.

If a future upstream release changes subagent identity env vars such as `PI_SUBAGENT_AGENT`, the local runtime override extension may need a small compatibility update.
