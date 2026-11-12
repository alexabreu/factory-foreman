# Persona evals

Measures whether a change to a persona's prompt helps: each case's task goes to a harness several times, and each
reply is scored against the case's weighted checklist (Tessl's scenario and criteria format, with the checks as
JavaScript). Compare a baseline with a candidate on the same cases; a change is better when precision items don't
drop and recall items rise, over repeated runs.

```sh
node evals/run.mjs --persona code-reviewer --runs 3 --label baseline
node evals/run.mjs --persona code-reviewer --runs 3 --label candidate --agent path/to/changed.agent.md
node evals/run.mjs --persona code-reviewer --harness codex --runs 3
```

- `cases/` holds **synthetic** seeded-defect cases against the public sample app. Each has `scenario.json` (the
  task and its input files), `criteria.mjs` (weighted checks), and `files/`.
- Cases built from **private** repositories (for example flight-components) never enter this repo. Keep them
  where they came from and pass `--cases <dir>`.
- Full results, including every reply, go to `evals/results/`, which git ignores. Only aggregate scores (mean,
  spread, per criterion) are recorded publicly, never a reply, diff, file path or code excerpt from a private case.
- Nothing in a case is executed; the model only reads it.
