# Install notes

## Local install

Install the repo directly as a local Pi package:

```bash
pi install /home/ashalom/Github/pi_agent_stuff
```

## Temporary test

Load it for a single run:

```bash
pi -e /home/ashalom/Github/pi-agent-stuff
```

## Git install

After publishing to GitHub:

```bash
pi install git:github.com/<your-user>/pi-agent-stuff
```

## Important note about duplicate extensions

If an extension exists both:
- in this package, and
- in `~/.pi/agent/extensions/`

Pi may load both copies. After confirming the package version works, remove or disable the duplicate global copy.
