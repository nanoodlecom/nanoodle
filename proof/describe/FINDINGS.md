# Describe-changes: strategy bake-off (live, nano-gpt)

Goal: let a user edit the **workflow graph** with a text description (like editing the app),
via the LLM producing a change we apply to the graph. Question: which "diff" representation
is most reliable across models (users bring their own key → can't assume a strong model)?

## Setup
- `core.mjs` — node schema doc, prompt builder, 3 apply strategies, local diff, layout-preserving rebuild.
- `bakeoff.mjs` — 6 cases (empty→build, seed edits, removals) × 3 strategies, applied + structurally validated.
- `pipeline.mjs` — proves the shipping path end-to-end (full rewrite → computed diff → layout-preserving apply).
- Key insight applied to all strategies: show the model a **simplified semantic graph**
  (`{id,type,fields}` nodes, `"node.port"` links) — strip x/y/w/sizes layout noise — then
  re-inject layout on apply by matching stable ids.

## Live scorecard (valid = parsed + applied + structurally valid, n=6)
| strategy | gemini-2.5-flash | kimi-k2-instruct |
|----------|------------------|------------------|
| **full** (emit whole graph) | **6/6** | **6/6** |
| ops (edit op-list)          | 6/6 | 4/6 |
| udiff (unified diff)        | 4/6 | 3/6 |

- **udiff is brittle**: models emit JSON with trailing commas / off-by-one context → patch fails. Rejected.
- **ops is model-sensitive**: weaker model drops to 4/6 (bad ids, malformed ops). Rejected as primary.
- **full is model-robust**: "emit the whole desired graph as JSON" is the easiest task for any model.
- Reasoning models (gpt-oss-120b) burn the default token budget on hidden reasoning and return
  EMPTY content (`finish_reason: length`) → must send `max_tokens` and prefer instruct models.

## Decision
**Full-graph rewrite + a diff we compute locally + layout-preserving apply.**
- Generation is the robust `full` strategy (works even on weaker keys).
- We don't trust the model to emit diff *syntax* (that's what sank udiff). We diff prev-vs-next
  ourselves → a human-readable preview the user approves ("+ add tts node", "~ instrumental: false→true").
- This is faithful to "create a diff then apply it" and to gptdiff's propose→review→apply flow,
  while keeping the surgical preview of `ops` without its fragility.
- Stable ids in the prompt → surviving nodes keep their canvas position; only new nodes auto-place.

## Proven end-to-end (gemini, pipeline.mjs)
- "speak the lyrics aloud" → + tts node, + wire n17.text→tts.prompt. layout preserved.
- "make instrumental" → ~ n19.instrumental: false→true. surgical.
- "remove the style node" → – node, rewire lyrics→music. correct.
- "haiku → image" (empty canvas) → + llm + image, wired. builds from scratch.
