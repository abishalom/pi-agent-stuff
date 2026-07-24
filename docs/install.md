# Install notes

## Included subagent implementation

This repo ships its own Herdr-native Pi subagents extension under `pi-extension/herdr-subagents/`. Herdr is the only v1 backend. Do not separately install `pi-interactive-subagents`; it registers conflicting tools and commands.

## Local install steps

### 1. Install npm dependencies

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm install
```

### 2. Install this repo as a Pi package

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

### 3. Install or refresh Herdr's Pi integration

```bash
herdr integration install pi
```

### 4. Start Pi inside Herdr

Launch or attach to Herdr, open a shell pane, and run `pi` there. The subagent extension requires Pi's TUI mode plus `HERDR_ENV=1` and `HERDR_PANE_ID`, which Herdr injects automatically.

### 5. Reload after package changes

```text
/reload
```

See `docs/2026-07-15-herdr-subagents-usage.md` for commands, tools, roles, lifecycle behavior, and manual fallback instructions.

## Config

Per-agent model and thinking settings live in:

- `config/subagent-model-overrides.json`

Bundled adapted role definitions live in:

- `pi-extension/herdr-subagents/agents/`

Trusted projects can override definitions under `.pi/agents/`; global definitions live under Pi's agent directory. Reload Pi after changing definitions or policy.

## Updating dependencies

Update only dependencies declared by this package:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update
npm test
```

Commit both `package.json` and `package-lock.json` when dependency versions change, then reload Pi or reinstall this repo package.
