# Install notes

## What changed

This repo no longer ships its own subagents implementation.

It now depends on the upstream package:
- `git:github.com/HazAT/pi-interactive-subagents`

In this repo, that upstream package is consumed through `node_modules/` as an npm dependency. The only local subagent-specific code left here is the runtime model/thinking override extension.

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

### 3. Start Pi inside a supported multiplexer

Examples:

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

## Direct upstream install vs repo-managed install

The upstream package recommends:

```bash
pi install git:github.com/HazAT/pi-interactive-subagents
```

That works if you want to use the package directly.

This repo uses a different setup on purpose:
- upstream package behavior comes from the dependency in `node_modules/`
- local model/thinking policy comes from this repo
- prompts stay upstream

Use the repo-managed install when you want this repo's override policy.

## Config

Per-agent model and thinking settings live in:

- `config/subagent-model-overrides.json`

Reload Pi after changes:

```text
/reload
```

## Updating the upstream extension

This repo does not update upstream through `pi install git:github.com/HazAT/pi-interactive-subagents`.

Instead, update the npm dependency that this repo loads from `node_modules/`:

```bash
cd /home/ashalom/Github/pi-agent-stuff
npm update pi-interactive-subagents
npm test
```

Then either reload Pi or reinstall this repo package:

```text
/reload
```

or:

```bash
pi install /home/ashalom/Github/pi-agent-stuff
```

If you want to pin a tag or commit instead of the moving default branch, change the dependency spec in `package.json`, run `npm install`, and commit the updated lockfile.
