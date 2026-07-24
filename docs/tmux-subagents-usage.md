# Legacy tmux subagents usage — superseded

This package no longer loads `pi-interactive-subagents` and no longer provides a tmux subagent backend.

Herdr is the only v1 backend for persistent Pi children. See:

- [`2026-07-15-herdr-subagents-usage.md`](./2026-07-15-herdr-subagents-usage.md)
- [`herdr-subagents-technical-spec.md`](./herdr-subagents-technical-spec.md)

Normal Pi usage inside tmux remains possible, but the `subagent`, `subagent_followup`, `subagent_interrupt`, and `get_subagent_result` tools require the parent Pi TUI to run inside Herdr.
