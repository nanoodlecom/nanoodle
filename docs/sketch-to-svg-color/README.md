Sketch to SVG color-render release preparation

PR #807 stays draft. Root reports one execution of the exact candidate in the signed-in Nanoodle browser, producing a color JPEG and an SVG with 20 paths and no embedded raster. Original exports are still pending from that handoff. Those are reported observations, not a byte-level inspection by this executor. Do not rerun. This executor has made no billable calls and has no authentication work assigned.

`candidate-graph.json` is the exact tested candidate. The original 512×512 pencil sailboat fixture is `examples/gallery/sketch-to-svg/sketch.png`. Its upload → Qwen Image 2.1 Edit color render → Ideogram Vector convert chain is verified offline against both the installed engine and SDK main b5fe8a89eec726637ae92a7f54053bc6cef8d7e3. `check-sketch-to-svg.mjs` currently tests this candidate; point it directly to the promoted canonical graph before final release review, without a fallback that could hide gallery drift.

Source of truth and ownership

- `index.html` EXAMPLES contains the editor card and reusable graph. `scripts/sync-examples.mjs` normally replaces that graph from the sibling awesome-noodles `graphs/sketch-to-svg.noodle-graph.json`; this slug is not gallery-only. Do not silently bypass that sync rule.
- The existing owner checkout is task-7/awesome-noodles, head 75edff76dbaf97ac5e777aa841ac6da6e35df3be. Its sketch graph, introduced by 32d0c3a, matches the current gallery graph as parsed JSON. `source-map.json` records exact hashes. That checkout was inspected read-only and left clean. Root must coordinate the upstream change with its existing owner. `awesome-noodles-sketch-to-svg.patch` is a prepared single-file patch, not an applied or published upstream change.
- `examples/gallery/sketch-to-svg/graph.json` is the sampled graph. `workflow.json` is the reusable graph. Their SHA-256 values live in the matching `samples.json` entry. `run.json` is the saved run manifest and must identify the real captured outputs and cost evidence.
- `samples.json` supplies input/output paths, labels, model IDs, date, run cost, asset hashes and preview. `sync-gallery-samples.mjs` renders the gallery, and `sync-guide-examples.mjs` combines that entry with its HOWTO copy to render the guide, hub and neighboring links. `release-copy.json` contains prepared instructional copy; it is not activated yet.
- Historical CAMP badge media and source-run metadata stay unchanged. The alternate is now explicitly labeled Earlier workflow on both surfaces, preserving its existing anchor and Updates links while removing the false same-workflow claim.

Pending original inputs

1. Original color JPEG and returned SVG bytes from the existing browser run, plus their captured node identities. No screenshots or reconstructed SVG may substitute for them.
2. Source run record: exact graph identity, execution time/date, per-node status, model, original MIME and output mappings; recorded charge/settlement evidence. The November 15 catalog quote was $0.302, not proof of the charged amount.
3. Browser graph/run reference or export needed to tie the outputs to the exact candidate. Candidate SHA is in source-map.json.

After originals arrive

- Inspect the actual JPEG and SVG, parse the SVG shapes/fills and reject embedded raster substitution. Rasterize the SVG locally for a side-by-side comparison; check colored regions and composition against the JPEG and sketch. The reported 20 paths must be checked against the real bytes.
- Promote the same candidate to graph.json and workflow.json; update run.json, samples.json and preview with original output bytes and measured hashes. Preserve any retained older output as explicitly historical. Keep Color render visible as its own named stage.
- Apply the prepared guide copy, update the editor card through the coordinated upstream source, and point check-sketch-to-svg.mjs at the canonical gallery graph. Regenerate the gallery/guide and other required artifacts. Preserve historical update text; update link titles only if the featured title changes so existing links remain truthful.
- Run full offline/generator checks, app and SDK routing checks, guide/gallery browser loading and stubbed rerun checks, and CI. Root routes the final exact head through Ada. No merge, deployment, or main push is authorized during this preparation phase.

No Nano/NEAR payment copy, pricing code, retry, MCP, settlement, security or unrelated repair files belong in this PR.
