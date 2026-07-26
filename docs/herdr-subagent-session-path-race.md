# Herdr subagent startup session-path race

## Observed issue

On 2026-07-26, three concurrent launches through the `subagent` tool created working Pi tabs but failed with:

```text
Herdr started Pi but did not report its session JSONL path.
Child surface remains open at <pane>.
```

The tabs remained open and idle. Their initial tasks were not submitted, and the parent runtime did not track them, so `get_subagent_result` subsequently reported that the panes were not owned by the parent.

Observed with:

- Herdr `0.7.5`
- Current Pi integration `v6`
- `pi-extension/herdr-subagents`

## Evidence

The Herdr server log showed successful `agent.start` responses around `01:15:40`, while Herdr did not detect the Pi processes until approximately `01:15:43`:

```text
01:15:40 agent.start completed outcome="ok"
01:15:43 agent changed ... agent=Some(Pi)
```

After detection, `herdr agent get <pane>` contained both `interactive_ready: true` and a valid `agent_session.value` JSONL path. Thus Pi started correctly; the session metadata simply was not available in the original `agent.start` response.

## Cause

`HerdrSubagentsRuntime.launch()` assumes that `startPi()` returns the session path synchronously:

```ts
const started = await this.client.startPi(...);
const sessionPath = started.sessionPath;
if (!sessionPath) throw new Error("Herdr started Pi but did not report its session JSONL path");
```

See `pi-extension/herdr-subagents/index.ts` near line 224.

This creates a race between successful process startup and Herdr's later Pi/session detection. When the check fails, the extension exits before calling `prompt()` or `monitor.track()`, leaving an untracked child tab behind.

Concurrent launches may make the race easier to trigger, but the underlying problem is that the extension does not wait for session metadata after `agent.start` succeeds.

## Suggested fix

If `startPi()` returns without `sessionPath`, poll `agent get` for the child pane until:

- `sessionPath` is present, and
- preferably `interactiveReady` is `true`.

Use the existing startup deadline/abort signal, then submit the initial prompt and register the child normally. On a genuine timeout, either close the created surface or return enough information to recover and track it explicitly.

A regression test should model `agent.start` returning a pane without `sessionPath`, followed by `agent get` returning the fully detected Pi session.