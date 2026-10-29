# Vector conversion and chained video workflows

Status: prepared on the fix branch. These changes are not a published package
release or a deployed site. Use a checkout containing the fixes until releases
are verified; do not patch installed executor source files.

## Convert a raster image into SVG

Use an Upload node wired to an Edit node with model `ideogram/vector`.
Set `fields.modelOpts` to `{"vector_operation":"convert","mode":"default"}`.
The Edit prompt may be blank for this exact model and operation. Other Vector
operations and ordinary edit models still need an instruction. The source image
is required in every conversion run.

```json
{
  "nodes": [
    {"id":"source","type":"upload","name":"Source","fields":{"image":""}},
    {"id":"vector","type":"edit","name":"Vector","fields":{
      "model":"ideogram/vector","prompt":"",
      "modelOpts":{"vector_operation":"convert","mode":"default"}
    }}
  ],
  "links":[{"id":"l1","from":{"node":"source","port":"image"},"to":{"node":"vector","port":"image"}}]
}
```

For text-to-SVG generation, use an Image node, provide a prompt, and select the
model's generation operation. Image and Edit forward model knobs from
`fields.modelOpts`; routing, authentication, prompt, source/mask, size, response
format and `n` stay controlled by the executor. Set variations on the Image node
and seed on the node's `seed` field. Do not put credentials in a saved graph.

SVG responses receive `image/svg+xml`; the headless CLI chooses `.svg` when
saving them. Save the returned bytes without rasterizing them or renaming them
to `.png`.

## Extend one generated clip twice

Wire Text → Text-to-Video (`grok-imagine-video-1.5-lite`) → Video Edit
(`minimax/h3-max-turbo/extend-video`) → another Video Edit with the same H3 model.
Wire each `video` output to the following `video` input. Put continuation
instructions on each Edit node and choose the model's supported duration and
resolution. For the H3 extended output, set `fields.modelOpts.output` to
`"extended"` on both Video Edit nodes.

Provider-relative content URLs are resolved before the next video request:
a redirect yields the signed file URL, while a small direct response is inlined.
The API credential stays on the provider API origin. Large direct responses
that cannot fit the inline budget fail clearly; use a provider-returned file
redirect rather than manually copying authenticated content paths into graphs.

The JavaScript SDK's provider-relative resolver was already merged in PR #49.
The site's browser-specific resolution and retry changes remain the subject of
PR #756; this branch does not duplicate that shim. Verify that PR and its fixes
are available before describing the browser chain as supported in a release.

All regression evidence for these fixes uses recorded responses or local mock
servers. It does not establish live provider quality or pricing. Running either
workflow with a real NanoGPT key spends from that user's balance.
