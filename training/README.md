# Training code (optional)

Kernel + pipeline builders for CareerOps-4B. **Not required** to run the web app.

## Weights

Published model: [telivity/CareerOps-4B](https://huggingface.co/telivity/CareerOps-4B)

Training **datasets are not in this repo**. Build your own corpora or use a public Hugging Face dataset you control.

## Layout

```text
training/
  kernel/           # Kaggle / torchrun train + eval helpers
  scripts/pipeline/ # Synthetic corpus builders / validators
  tests/            # Tests with synthetic fixtures only
  fixtures/         # Tiny invented examples
```

## Environment

```bash
export CAREEROPS_DATA=/path/to/your/data   # raw + staging + eval live here
export PYTHONPATH="$(pwd):${PYTHONPATH:-}" # so `training.scripts.pipeline` imports resolve
```

## Kernel metadata

Copy `kernel/kernel-metadata.example.json` → `kernel-metadata.json` and point `id` / `dataset_sources` at **your** Kaggle user or org (e.g. `telivity/…`). Do not commit personal handles.

## Privacy

Never commit real résumés, personal eval JSONL, API keys, or operator vault notes. `npm test` runs `scripts/privacy-scan.mjs` and will fail the build if identity / secret / vault fingerprints appear under `training/`.
