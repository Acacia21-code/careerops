# CareerOps plugins (hooks, not a browser extension)

Phase 4 extension registry: **local manifests + host-registered handlers**. Hosted demos never eval remote code or accept arbitrary uploads.

## Extension points

| Type | Purpose |
|------|---------|
| `board_source` | Merge extra ATS board packs into Find (`ats_boards`) |
| `report_kind` | Declare custom `mt_reports.kind` handlers / renderers |
| `board_pack_schema` | Additive pack fields under `extensions.fields` (no schema_version bump required) |

## Manifest

Format `careerops-plugin-manifest`, `schema_version` 1. Doctrine flags `no_auto_apply`, `no_auto_send`, and `no_invented_facts` must stay `true`.

Example: [`packages/careerops/plugins/example-careerops-hooks/manifest.json`](../packages/careerops/plugins/example-careerops-hooks/manifest.json)

Runtime helper + example adapter:

- [`web/lib/plugin-registry.mjs`](../web/lib/plugin-registry.mjs)
- [`web/lib/plugins/example-adapter.mjs`](../web/lib/plugins/example-adapter.mjs)

```js
import { createRegistry, registerFromManifest, mergeBoardSources } from './lib/plugin-registry.mjs'
import { registerExamplePlugin } from './lib/plugins/example-adapter.mjs'

const registry = createRegistry()
registerExamplePlugin(registry)
const boards = mergeBoardSources(registry, profile.ats_boards || {})
```

## Board pack

Packs use `schema_version` 5. Optional additive `extensions`:

```json
{
  "extensions": {
    "plugins": ["example-careerops-hooks"],
    "fields": { "example_note": "" },
    "chain_runs": []
  }
}
```

Pass `reportKinds: ['decision_memo']` into `buildBoardPack` (or register kinds on the registry) so custom report rows export.

## Out of scope

Chrome / browser extensions, remote code upload in the hosted demo, auto-apply, auto-send.
