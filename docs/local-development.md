# Local development workflow

This repo is the source of truth for the `pi-agent-stuff` package.

## Recommended workflow

### 1. Edit in the repo

Make changes in `~/Github/pi-agent-stuff`. Do not treat `~/.pi/agent/extensions/` as the source of truth.

### 2. Install dependencies after pulling changes

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm install
```

### 3. Load the repo as a local Pi package

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

For a one-off run:

```bash
pi -e /home/ashalom/Github/pi-agent-stuff
```

### 4. Run Pi inside Herdr

Herdr is the only v1 subagent backend. Ensure its Pi integration is current:

```bash
herdr integration install pi
```

Then run Pi in a Herdr pane. Do not set `PI_SUBAGENT_MUX`; this implementation uses Herdr's native `agent`, `pane`, and `tab` commands directly.

### 5. Validate changes

```bash
npm test
npx tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck pi-extension/herdr-subagents/*.ts
```

The automated tests inject a fake `HerdrClient` and never create real panes. Perform deliberate manual Herdr smoke tests separately and close only surfaces created by the test.

### 6. Reload after config or extension changes

```text
/reload
```

A reload stops parent monitoring but intentionally leaves existing child panes and Pi processes running. The replacement parent runtime does not reconnect them in v1.

## Avoid duplicate subagent extensions

Do not install `pi-interactive-subagents` alongside this package. It defines overlapping tool and command names.

## Stable vs experimental

- Stable/shareable resources belong in the normal package directories.
- WIP resources belong under `experimental/`.
- `experimental/` is committed to git but excluded from the package manifest by default.
