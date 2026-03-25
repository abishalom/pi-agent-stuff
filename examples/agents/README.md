# Agent override examples

This repo does not use local agent markdown overrides by default.

Why:
- upstream `pi-interactive-subagents` owns the bundled prompts
- copying agent markdown files locally would also shadow prompt updates

For this repo, prefer changing only:
- `config/subagent-model-overrides.json`

Use `.pi/agents/*.md` or `~/.pi/agent/agents/*.md` only if you intentionally want to fork prompt content.
