# Signed-out sample run — video result

Proof that a signed-out visitor who adds an Image→Video node to the starter graph gets a real
video result, and that the run costs nothing.

## Run it

```
node proof/demo-video/verify-demo-video.mjs
```

The check is offline and deterministic. It serves the worktree, starts Microsoft Edge in headless
mode, and drives the real `index.html` through CDP. It blocks the whole `nano-gpt.com` origin, and
it records each request that the page tries to make. The run must show 36 passed, 0 failed.

The check makes these statements, and it tests each one:

- The starter graph, and the starter graph plus one Image→Video node, are both sample runs.
- The run-cost chip stays visible in a sample run. It reads `~$X to run for real`.
- The chip figure increases when the visitor adds the video node. The video node also shows its
  own price.
- All 4 nodes finish. The video node output is a `data:video/mp4` URL. The clip decodes to
  640x360 and 5.04 s.
- The result carries the `✨ sample result` badge. The ⬇ save and ↗ open buttons are present.
- The pill says that the clip is a canned example and that it ignores the visitor's prompt.
- `sw.js` does not precache the clip. The service-worker fetch handler caches it at first use,
  and the cached bytes are the shipped file.
- The page calls no billable endpoint. No request reaches `nano-gpt.com`. The sample run finishes
  with the API unreachable.

## The catalog fixture

`catalog-fixture.json` holds 3 normalized catalog entries: the two models of the starter graph, and
the model that an appended Image→Video node selects. The check puts them in `localStorage`, because
the run-cost chip needs prices and the network is off.

To record the fixture again:

```
node proof/demo-video/verify-demo-video.mjs --capture
```

This is the only mode that contacts `nano-gpt.com`. It reads the free public model lists
(`GET /api/v1/{models,image-models,video-models}`) and takes the entries from the app's own
`localStorage` cache, so the shape cannot differ from the app's normalizers. It never runs a graph,
and it spends nothing. Prices change, so record the fixture again instead of an edit by hand.

## The clip

`demo-sample.mp4` in the repository root is a real clip. `scripts/gen-demo-clip.mjs` renders it from
the shipped `demo-sample.jpg` and records the model and the cost.
