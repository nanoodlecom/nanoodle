Sketch to SVG color-render rework

Candidate only: no new saved output or live success is claimed. The current gallery run remains unchanged until a real two-step run is captured and visually reviewed.

The original 512×512 pencil sailboat fixture is examples/gallery/sketch-to-svg/sketch.png. Candidate graph: Sketch image (upload) → Color render (Qwen Image 2.1 Edit, 1k) → Colored icon → SVG (Ideogram Vector, convert/default, blank prompt). The fixed render instruction preserves objects and composition and fills closed regions with color.

The public NanoGPT image catalog on 2026-11-15 quotes $0.03 + $0.272 = $0.302 for one output per node. No metered request has been sent. The executor lacks NANOGPT_API_KEY and an approved existing credential route is pending. No package, provider, permission, or account changes are needed.

Current main includes SDK source src-e22eff919870, matching SDK main b5fe8a89eec726637ae92a7f54053bc6cef8d7e3. App vector routing and all five SDK vector regressions pass offline.

Release gates: capture the actual run and costs; inspect sketch, colored raster and SVG (colored fills, no embedded raster, correspondence with the color render); replace the featured graph/run/sample metadata and generated gallery/guide together; reconcile the awesome-noodles graph source with its owner through the root; pass full checks, exact-head review and CI before the normal PR merge/deploy path. Historical prompt-only outputs must remain explicitly historical if retained.
