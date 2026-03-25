# Local development workflow

This repo is the source of truth for the `pi-agent-stuff` package.

## Recommended workflow

### 1. Edit in the repo

Make changes in:

- `~/Github/pi-agent-stuff`

Do not treat `~/.pi/agent/extensions/` as the source of truth.

### 2. Install dependencies after pulling changes

Because this package loads the upstream subagents package from `node_modules/`, install dependencies locally:

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

### 4. Start Pi inside a supported multiplexer

```bash
cmux pi
# or
tmux new -A -s pi 'pi'
# or
zellij --session pi
```

Optional:

```bash
export PI_SUBAGENT_MUX=tmux
```

### 5. Reload after config or extension changes

```text
/reload
```

## Cutover notes

Avoid loading duplicate copies of subagents.

Do not use both of these at the same time unless you want duplicates:
- this repo package
- a separate direct Pi install of `git:github.com/HazAT/pi-interactive-subagents`

## Updating upstream

From the repo root:

```bash
npm update pi-interactive-subagents
npm test
```

Then reload Pi or reinstall the local package.

## Stable vs experimental

- Stable/shareable resources belong in the normal package directories
- WIP resources belong under `experimental/`
- `experimental/` is committed to git but excluded from the package manifest by default
