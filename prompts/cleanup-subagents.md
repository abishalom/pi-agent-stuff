---
description: Close finished Herdr-managed subagent panes without disturbing active work
---
Clean up finished Herdr subagents in the current Herdr workspace.

1. Confirm `HERDR_ENV=1`. If it is not set, explain that this command only operates from a Herdr-managed Pi pane and stop.
2. Run `herdr pane list` and inspect the complete JSON response.
3. Identify only panes that are clearly extension-managed subagents: they must have a `tokens.role` value and `agent_status` of `idle` or `done`.
4. Do **not** close the focused/current pane, or any pane whose status is `working`, `blocked`, or `unknown`. Do not close untagged Pi panes, shells, or any pane outside the current workspace.
5. Close every identified finished subagent with `herdr pane close <pane-id>`. Continue if one close fails, and do not retry a failed close blindly.
6. Report the pane IDs and labels closed. If there were no eligible panes, say so. Report any close failures separately.

Do not interrupt agents, send prompts or keys, create panes, or close tabs/workspaces directly.
