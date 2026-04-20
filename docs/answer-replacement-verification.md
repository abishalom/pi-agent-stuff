# `/answer` replacement verification

Date: 2026-04-20

## What was changed

- Replaced upstream `./node_modules/mitsupi/extensions/answer.ts` with local `./pi-extension/answer/index.ts` in `package.json`
- Added repo-managed config at `config/answer.json`
- Added helper modules for config loading, model selection, source selection, and UI
- Added automated tests for config fallback, model priority, source selection, and command registration/submission formatting

## Commands run

### Automated test suite

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm test
```

Result:
- passed (`17` tests)

Coverage from tests:
- package manifest now points at local `/answer`
- no upstream `mitsupi/extensions/answer.ts` entry remains in `package.json`
- `/answer` command and `Ctrl+.` shortcut are registered by the local extension
- final submission prefix remains exactly:
  - `I answered your questions in the following way:\n\n`
- config loader falls back safely for:
  - missing config
  - malformed JSON
  - invalid fields
- thinking-level configuration verified for:
  - default `minimal`
  - explicit `low`
- model selection behavior verified for:
  - current default priority
  - changed priority order (Codex mini before GitHub Copilot)
  - fallback to current model
  - no usable model available
- source selection behavior verified for:
  - `last-assistant`
  - `last-user`
  - `last-turn`
  - `whole-branch`
- failure cases verified for:
  - no assistant message found
  - last assistant message incomplete

### Fresh pi process, explicit package load

```bash
printf '%s\n' '{"id":"1","type":"get_commands"}' \
  | PI_CODING_AGENT_DIR=$(mktemp -d) pi --mode rpc --offline --no-session -e /home/ashalom/Github/pi-agent-stuff
```

Verified from the RPC response:
- `/answer` is present
- it is sourced from:
  - `/home/ashalom/Github/pi-agent-stuff/pi-extension/answer/index.ts`
- no duplicate `/answer` command appeared in that process

### Fresh pi process using installed settings

```bash
tmp=$(mktemp)
printf '%s\n' '{"id":"1","type":"get_commands"}' | pi --mode rpc --offline --no-session > "$tmp"
node -e 'const fs=require("fs"); const lines=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n+/).filter(Boolean); for (const line of lines){ try { const obj=JSON.parse(line); if (obj.type==="response" && obj.command==="get_commands" && obj.success){ const answers=obj.data.commands.filter(c => String(c.name||"").startsWith("answer")); console.log(JSON.stringify(answers, null, 2)); break; } } catch {} }' "$tmp"
rm -f "$tmp"
```

Verified from the installed-package RPC response:
- exactly one `answer` command was returned
- it resolves to:
  - `/home/ashalom/Github/pi-agent-stuff/pi-extension/answer/index.ts`
- source metadata shows the installed package path points at `../../Github/pi-agent-stuff`

## Non-obvious implementation constraints

- The default `last-assistant` source logic intentionally preserves upstream behavior exactly:
  - it walks the current branch backward
  - errors immediately if the latest assistant message is incomplete
  - joins only text blocks
  - keeps the original `"No assistant messages found"` behavior if no usable assistant text exists
- Broken `config/answer.json` does **not** disable `/answer`; invalid fields fall back to defaults and warnings are logged to stderr
- `/answer` extraction uses `thinkingLevel: "low"` by default from `config/answer.json`
- The visible `/answer` flow is kept intentionally close to upstream; most behavior changes are isolated to helper modules
- Additional source modes (`last-user`, `last-turn`, `whole-branch`) are implemented, but only `last-assistant` is guaranteed to match upstream behavior exactly

## What is still best verified manually in a real TUI session

Automated coverage cannot fully prove TUI interaction details such as:
- real `Ctrl+.` key dispatch in your terminal/multiplexer
- loader rendering while extraction is running
- keyboard feel of the interactive Q&A component

Recommended manual smoke test after `/reload`:
1. trigger `/answer` on a session where the last assistant message contains questions
2. trigger `Ctrl+.` for the same flow
3. confirm the loader shows the selected extraction model
4. answer the prompts and confirm the submitted message text looks unchanged
