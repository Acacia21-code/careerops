# CareerOps mode chains (human-gated)

Declared skill pipelines over a **board pack**. Each step writes an `mt_reports` row; **human confirm** is required between steps. Never auto-apply / never auto-send / never invent experience.

## Builtin chains

| Id | Steps |
|----|--------|
| `prep-pipeline` | evaluate → rank → interview |
| `evaluate-interview` | evaluate → interview |

## CLI

```bash
# list
npx @telivity/careerops run-chain --list

# start (writes chain run metadata into the pack)
npx @telivity/careerops run-chain prep-pipeline --pack CareerOps_board_pack.json --role <role_id>

# after the agent writes mode output, attach it and wait for confirm
npx @telivity/careerops run-chain prep-pipeline --pack CareerOps_board_pack.json \
  --run <run_id> --report-file step.json

# human gate — required to advance
npx @telivity/careerops run-chain prep-pipeline --pack CareerOps_board_pack.json \
  --run <run_id> --confirm
```

`--confirm` without a prior `--report-file` / `writeStepReport` for the current step fails closed.

## Skill / agent surface

1. Load pack (`schema_version` ≥ 4; optional `extensions.chain_runs`).
2. `startChain` → follow `brief.instructions` for mode `evaluate` (etc.).
3. `writeStepReport` with materials-only body.
4. Stop and ask the human to confirm.
5. `confirmStep({ confirm: true })` → next brief or `done`.

Helpers: [`web/lib/mode-chains.mjs`](../web/lib/mode-chains.mjs)

## Out of scope

Autonomous apply, unsupervised parallel agents inventing bullets, skipping confirm gates.
