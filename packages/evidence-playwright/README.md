# @factory-foreman/evidence-playwright

A [factory-foreman](../core) evidence provider. When a slice iterates, the AC
gate runs the slice's frozen AC tests at its head; with this provider, that run
records a video of each test with the repo's own Playwright, and the videos are
published with the iteration and linked from its comment on the slice PR.

```json
{ "evidence": { "providers": ["agent-browser", "@factory-foreman/evidence-playwright"] } }
```

Install it as a dev dependency next to `factory-foreman`. Your Playwright config
is never changed: for that one run the provider writes
`factory-foreman-video.config.ts` (or `.mjs`/`.js`) next to it in the gate's
temporary checkout, importing your config and turning `video` on for every
project, and adds `--config` to the run. Only a run that calls `playwright test`
directly is recorded (`"run": ["npx", "playwright", "test"]`); one through a
package script (`pnpm test:e2e`) isn't, and the iteration says so rather than
stopping. In the iteration comment the provider is called `playwright-video`.
