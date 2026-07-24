# Herdr-native Pi subagents — superseded draft

**Status:** Superseded  
**Canonical specification:** [`herdr-subagents-technical-spec.md`](./herdr-subagents-technical-spec.md)

This draft was an earlier design exploration. Its selected features have been merged into the canonical technical specification, including:

- tabs as the default placement, with explicit split overrides;
- adapted Explorer, Planner, Worker, and Reviewer roles;
- the interactive `/subagent` launcher;
- `get_subagent_result`;
- 500 ms completion coalescing;
- tool allowlists and project-trust enforcement;
- presentation-only Herdr role metadata;
- JSONL-authoritative result extraction and persistent interactive child sessions.

Do not implement from this file. Where this draft and the canonical specification differ, the canonical specification wins.
