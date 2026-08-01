# Feature request — the image catalog says how many input images a model *accepts*, never how many it *requires* (and under-reports forced output counts)

**Endpoint:** `GET /api/v1/image-models`
(sibling to `NANOGPT-prompt-length-metadata.md`, which documents the same "the limit is data on your
side, but not in the catalog" shape for prompt length)

**Summary:** four separate gaps, all of which force a client to keep a hand-curated model list next
to the catalog. Live-scanned 2026-07-31 against all 215 image models, plus 64 representative models
probed end-to-end.

---

## 1. No `min_items` — a model that *requires* two images looks identical to one that accepts two

`input_image_constraints` exists on ~105 models and carries **`max_items` only**. There is no
`min_items` field anywhere in the catalog. For `flux-pro/v1/vto` the only machine-visible signal that
one image is not enough is free text:

```json
"flux-pro/v1/vto": {
  "max_input_images": 2,
  "supported_parameters": {
    "input_image_constraints": {
      "max_items": 2,
      "provider": { "note": "Requires exactly two images: person first (max 2MP), garment second (max 1MP)." }
    }
  }
}
```

Sending one image (verified 2026-07-31, **not charged**):

```
POST /v1/images/generations  {"model":"flux-pro/v1/vto","imageDataUrl":"data:image/png;…"}
400 {"error":"FLUX Virtual Try-On requires two input images: upload a person image first,
     then a garment image."}
```

That error is templated and names both roles, so the requirement — and the *ordering* — is data on
your side. In a node-graph tool this is worse than a wasted request: the editor draws one image port
because the catalog only said "up to 2", so the UI never even asks for the second image. The user
wires what they were shown and the run cannot succeed.

**Also: order is load-bearing and invisible.** Sending `[garment, person]` still renders — the route
auto-detects the wearer — but the output identity drifts toward the model in the garment photo. So a
client that treats the two slots as interchangeable produces a plausible *wrong* image, at full
price, with no error to notice.

**Ask:**

```json
"supported_parameters": {
  "input_image_constraints": {
    "min_items": 2,
    "max_items": 2,
    "roles": ["person", "garment"]
  }
}
```

`min_items` alone fixes the dead end; `roles` is what lets a client label the slots ("Person",
"Garment") instead of "Image 1", "Image 2" — which is the difference between a usable try-on app and
a coin flip on which photo goes where.

---

## 2. `fixed_image_count` is under-populated relative to what the API actually does

`fixed_image_count` is present on 14 models and is `> 1` on exactly two: `midjourney/text-to-image`
and `higgsfield-soul` (both `4`). That field is the right shape and we drive our disclosure off it.

The problem is that it reads as optional. Every one of the 64 models we probed honoured `n=1`, so as
of 2026-07-31 the catalog is *correct* — but nothing in the response distinguishes "this model
returns 1, and says nothing" from "this model returns 4, and says nothing". A client cannot tell
whether an absent `fixed_image_count` means one image or an unstated forced count, and the difference
is a 4× billing surprise on a run the user thought cost `$0.02`.

**Ask:** populate `fixed_image_count` (or `min_output_images`) on *every* model, `1` included, so its
absence stops being ambiguous. Bonus: `pricing.per_image` currently reads as the price of a run;
for a forced-count model the run costs `per_image × fixed_image_count`, and nothing says so.

---

## 3. Modality cannot separate "optional image input" from "image input required"

Three models are typed `"text+image->image"` and fail hard with no image:

| model | error with prompt only |
|---|---|
| `hidream-e1-1` | `No input image data provided … attach an image to edit` |
| `wan-2.6-image-edit` | `INVALID_IMAGE_INPUT` |
| `vidu-q2-reference` | fails without reference images (tagged `image-edit` / `multi-reference`) |

Three others carry the **same** modality string and generate happily from a bare prompt
(verified working text-only 2026-07-31): `nano-banana-2-lite`, `seedream-v4.5`, `qwen-image-3`.

So `architecture.modality` cannot be used to decide whether a model belongs in a text-to-image picker.
Neither can the id: none of the three failing ids contains `upscal` / `img2img` / `image-to-image`.
We ship a hardcoded id list (`NEEDS_SRC_IDS`), which goes stale the moment a model is added.

**Ask:** a boolean on the model, e.g. `capabilities.requires_image_input: true`, or make
`architecture.modality` say `image->image` when the image is not optional.

---

## 4. Models that are simply broken upstream (reporting, not an ask)

Uncharged in every case, probed 2026-07-31. Listing them because they are all still advertised in
the catalog, so a client that trusts the catalog will offer a dead end:

| model | failure |
|---|---|
| `riverflow-2-fast` | `400 invalid AIR identifier` |
| `riverflow-2-standard` | `400 invalid AIR identifier` |
| `gpt-image-1-mini` | fails fast, generic provider error |
| `cogview-4` | `IMAGE_PROCESSING_FAILED` |
| `lucid-origin` | `IMAGE_PROCESSING_FAILED` |
| `reve-text-to-image` | fails fast, generic provider error |
| `imagen-3.0-generate-002` | fails fast, generic provider error |

`riverflow-2.0-pro` works, so the two broken riverflow ids look like an AIR-mapping typo rather than
a provider outage. The other five fail with or without `size`.

---

## 5. Trap worth documenting: a MIME mismatch surfaces as a *dimensions* error

If a `data:` URL's declared MIME does not match its actual bytes (e.g. `data:image/png;base64,` in
front of JPEG data), the route does not report a format problem. It reports:

```
413 {"error":"…","code":"IMAGE_INPUT_TOO_LARGE"}
```

with nonsense dimensions in the message. We lost real time to this — the image was small, and every
signal pointed at a size limit. A `code: "IMAGE_INPUT_INVALID_FORMAT"` (or just not inferring
dimensions from a failed decode) would make it self-diagnosing.

---

## Our workaround (client-side, shipping meanwhile)

- `IMG_INPUT_ROLES = { "flux-pro/v1/vto": ["person", "garment"] }` — a curated map in
  `index.html`, `play.html` (RUNTIME_JS) and `nanoodle-js`, mirrored three ways and dated. It draws
  the right number of *labelled* ports, refuses the run before any paid call when a slot is empty,
  and suppresses port re-packing so unwiring the person can never silently promote the garment.
- `NEEDS_SRC_IDS` — the §3 id list, routing those three models to the edit picker.
- Disclosure driven off `fixed_image_count`: a locked variations control, "this model always returns
  4 images — you pay for all 4", and a per-run price that shows `×4`.

Every one of those is a list that has to be re-probed by hand. `min_items` + `roles` +
a fully-populated `fixed_image_count` would delete all of them.
