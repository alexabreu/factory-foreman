# factory-foreman

Keeps the shaping, decisions and reviews from your own agent sessions on the GitHub issue and its pull requests.
A feature moves through checkpoints (shape, design, slices, verify), each with an approval, a diff against the
last version and test evidence. It works from Claude Code, Codex and VS Code.

**Status: phase 0.** Nothing here is usable yet. This phase sets up the workspace and answers the open
questions in [docs/spikes.md](docs/spikes.md).

## Install

The package will install from this repository by tag. No tag exists yet; the first one will look like this:

```json
"factory-foreman": "github:alexabreu/factory-foreman#v0.1.0&path:/packages/core"
```

## Working on it

Node 22.18+ or 24.2+, and pnpm 10.

```sh
pnpm install
pnpm check        # lint and every package's tests
```

`packages/core` is the package. `fixtures/sample-target` is a small Vite app that the tests and spikes run
against. `tools/` holds maintainer scripts that don't ship.
