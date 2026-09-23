# vendor/next-action — Product · 2 action + graph-sketch schema

Contract for next-action recommenders: action vocab, node types, graph sketch
features, encode sizes, and intent-fork tags. Encode helpers turn history +
sketch into a fixed float vector.

Learned weights, gallery bake, and frequency baseline land in later Product · N
PRs. No `weightsUrl` / `.bin` here.

## Layout

| Path | Role |
| --- | --- |
| `schema.json` | Product · 2 contract (vocab, sketch, intent-fork tags, encode sizes) |
| `encode.mjs` | History + graph sketch → `Float32Array` (+ smallnet manifest helper) |

## Checks

```sh
node scripts/check-next-action-schema.mjs
```

Product · N / Fun labels only.
