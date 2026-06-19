# ai-apps

Small, self-contained AI web apps — each one is a single `.html` file that runs
entirely in the browser and talks straight to [NanoGPT](https://nano-gpt.com).
No server, no build step: open the file (or serve the folder) and go.

Each app handles its own auth (NanoGPT OAuth PKCE sign-in, or paste an API key)
and calls the model APIs directly from the browser. You pay per call on your own key.

## Apps

- **`noodle.html`** — a tiny ComfyUI-style node playground. Wire primitives
  together (Text, Join, LLM, Image, Edit, Vision, Text→Video, Image→Video,
  Text→Audio), drag from port to port (compatible inputs glow and snap by type),
  and hit Run to see each node's output. Full live model pickers for every
  modality (text, image, video, audio — built around `gpt-image-2`), image
  editing, async video generation, TTS, and save/load to JSON.
- **`pictureme.html`** — drop in one photo and see yourself reimagined across a
  grid of styles (Renaissance, cyberpunk, claymation, …), or fuse several looks
  into one hybrid.

## Running

Open any file directly, or serve the folder so OAuth redirects resolve cleanly:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000/noodle.html
```
