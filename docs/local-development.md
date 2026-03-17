# Local development workflow

This repo is the canonical source for `pi-agent-stuff`.

## Recommended workflow

### 1. Edit in the repo
Make changes in:

- `~/Github/pi_agent_stuff`

Do not treat `~/.pi/agent/extensions/` as the long-term source of truth.

### 2. Load the repo as a local Pi package
For day-to-day development:

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

For one-off testing without changing settings:

```bash
pi -e /home/ashalom/Github/pi_agent_stuff
```

### 3. Reload Pi after changes
Use:

```text
/reload
```

### 4. Avoid duplicate loading
The old global copies in `~/.pi/agent/extensions/` can cause duplicate commands or event handlers if the same extension is also loaded from this repo.

Recommended cutover:
1. Copy extensions into this repo
2. Verify the repo package loads correctly
3. Remove or disable duplicate global copies from `~/.pi/agent/extensions/`

A simple way to disable the old global copies is to rename them so Pi does not discover them as extensions.

## Publishing workflow
Once the repo is stable:
1. commit changes locally
2. push to GitHub
3. optionally switch your Pi install to the git-based package source

Use GitHub for sharing and versioning, not as the primary inner development loop.

## Stable vs experimental
- Stable/shareable resources belong in the normal package directories
- WIP resources belong under `experimental/`
- `experimental/` is committed to git but should stay out of the package manifest by default
