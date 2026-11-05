#!/usr/bin/env node
// Leftover titleIntent / classifyCard edges after #679.
// That PR shipped the HeyGen + Video Music Remover fixture through the
// full changelog pipeline (not Retired; "New video models: HeyGen Video 1").
// This file pins the leftover noun/verb contract the fixture never hit:
// a product noun "Remover" is a launch, the verb forms still retire,
// "Remover Retired" still retires, body text that says "removes" cannot
// flip a Remover launch, and an isolated Remover card is still New video.
// Offline, zero API spend. New file so it does not collide with
// check-sync-nanogpt-model-updates.
import { classifyCard, titleIntent, groupPending, availabilitySubjectTitles } from "./lib/nanogpt-updates.mjs";

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

{
  const nouns = [
    "HeyGen Video 1 and Video Music Remover",
    "Video Music Remover",
    "Background Remover",
    "VIDEO MUSIC REMOVER",
  ];
  let bad = 0;
  for (const t of nouns) {
    const intent = titleIntent(t);
    if (intent !== "new") {
      fail("Remover noun must stay new, got " + intent + " for " + JSON.stringify(t));
      bad++;
    }
  }
  if (!bad) ok("product noun Remover is a launch, not a retirement");
}

{
  const verbs = [
    ["Remove unused models", "retired"],
    ["Models removed", "retired"],
    ["Background removal", "retired"],
    ["Removing GPT-4o Image", "retired"],
    ["NanoGPT removes CrofAI", "retired"],
    ["Legacy GPT-4o Image Retired", "retired"],
    ["Video Music Remover Retired", "retired"],
  ];
  let bad = 0;
  for (const [t, want] of verbs) {
    const intent = titleIntent(t);
    if (intent !== want) {
      fail(JSON.stringify(t) + " → " + intent + " (want " + want + ")");
      bad++;
    }
  }
  if (!bad) ok("verb forms and Remover+Retired still classify as retired");
}

{
  if (titleIntent("") !== "new" || titleIntent(null) !== "new")
    fail("empty/null title must stay new, not retired");
  else ok("empty/null title stays new");
}

{
  const info = classifyCard({
    id: "remover-only",
    title: "Video Music Remover",
    text: "[Video Music Remover](https://nano-gpt.com/media?mode=video&model=video-music-remover) removes background music from existing footage.",
    date: "2026-10-01",
    category: "models",
  });
  if (info.intent !== "new")
    fail("isolated Remover launch intent must be new, got " + info.intent);
  else if (info.kind !== "video" || info.skip)
    fail("isolated Remover launch must be New video, got kind=" + info.kind + " skip=" + info.skip);
  else if (info.models.length !== 1 || info.models[0].slug !== "video-music-remover")
    fail("isolated Remover launch must keep its model link, got " + JSON.stringify(info.models));
  else ok("isolated Remover launch is New video even when the body says removes");
}

{
  // 2026-11-05 NanoGPT #1435 links bare /media?model= (no mode=); it used to be skipped.
  const info = classifyCard({
    id: "1435",
    title: "GPT Image 2.6 Flare and Sunburst",
    text: "[GPT Image 2.6 Flare](https://nano-gpt.com/media?model=gpt-image-2.6-flare) and [GPT Image 2.6 Sunburst](https://nano-gpt.com/media?model=gpt-image-2.6-sunburst) generate and edit images with up to 16 references. The image API also generates animated GIFs with 2–64 frames.",
    date: "2026-11-05",
    category: "media",
  });
  if (info.skip || info.kind !== "image")
    fail("bare /media?model= card must be New image, got kind=" + info.kind + " skip=" + info.skip);
  else if (info.models.map(m => m.slug + ":" + m.kind).join(",") !== "gpt-image-2.6-flare:image,gpt-image-2.6-sunburst:image")
    fail("bare /media?model= card must keep both models as image, got " + JSON.stringify(info.models));
  else ok("bare /media?model= card is New image with both models");

  const vid = classifyCard({
    id: "bare-video",
    title: "Example Motion 2",
    text: "[Example Motion 2](https://nano-gpt.com/media?model=example-motion-2) turns a still image into a 5 second video.",
    date: "2026-11-05",
  });
  if (vid.skip || vid.kind !== "video")
    fail("bare /media?model= video card must be video, got kind=" + vid.kind + " skip=" + vid.skip);
  else ok("bare /media?model= card that says video is New video");
}

{
  const info = classifyCard({
    id: "1433",
    title: "LongStories: Turn One Idea Into a Short Film",
    text: "LongStories is now on NanoGPT. It animates the shots and edits a finished short film.\n\nTry it at [nano-gpt.com/media](https://nano-gpt.com/media?model=longstories%2Fstory-fast).",
    date: "2026-11-05",
    category: "media",
  });
  if (info.skip || info.kind !== "video")
    fail("LongStories card must be New video, got kind=" + info.kind + " skip=" + info.skip);
  else if (info.models.length !== 1 || info.models[0].name !== "LongStories")
    fail("URL link text must not become the model name, got " + JSON.stringify(info.models));
  else ok("URL link text falls back to the title head (LongStories)");
}

{
  // Dotted version names (Qwen3.8, GLM-5.3) must not be treated as URL hosts.
  // NanoGPT titles are often "New Model: <name>"; the old host regex rewrote
  // the link text to the title head ("New Model") and shipped
  // "New LLM model: New Model".
  const qwen = classifyCard({
    id: "dotted-qwen38",
    title: "New Model: Qwen3.8",
    text: "[Qwen3.8](https://nano-gpt.com/conversation?model=qwen%2Fqwen3.8) is now available.",
    date: "2026-11-05",
  });
  if (qwen.skip || qwen.kind !== "chat")
    fail("Qwen3.8 card must be New LLM, got kind=" + qwen.kind + " skip=" + qwen.skip);
  else if (!qwen.models.length || qwen.models[0].name !== "Qwen3.8")
    fail("Qwen3.8 dotted name must stay the model name, got " + JSON.stringify(qwen.models));
  else ok("dotted Qwen3.8 keeps its model name (not New Model)");

  const glm = classifyCard({
    id: "dotted-glm53",
    title: "New Model: GLM-5.3",
    text: "[GLM-5.3](https://nano-gpt.com/conversation?model=z-ai%2Fglm-5.3) is now available.",
    date: "2026-11-05",
  });
  if (glm.skip || glm.kind !== "chat")
    fail("GLM-5.3 card must be New LLM, got kind=" + glm.kind + " skip=" + glm.skip);
  else if (!glm.models.length || glm.models[0].name !== "GLM-5.3")
    fail("GLM-5.3 dotted name must stay the model name, got " + JSON.stringify(glm.models));
  else ok("dotted GLM-5.3 keeps its model name (not New Model)");

  // URL-shaped link text with a real TLD+path must still fall back to the title head.
  const urlish = classifyCard({
    id: "urlish-still",
    title: "LongStories: Turn One Idea Into a Short Film",
    text: "Try it at [nano-gpt.com/media](https://nano-gpt.com/media?model=longstories%2Fstory-fast).",
    date: "2026-11-05",
  });
  if (!urlish.models.length || urlish.models[0].name !== "LongStories")
    fail("real URL link text must still fall back to title head, got " + JSON.stringify(urlish.models));
  else ok("real URL link text still falls back to title head after TLD tighten");
}

{
  // NanoGPT #1423 "Model Availability Changes" recommends switching to a live
  // model. That must be Retired guidance, never "New LLM model: <replacement>".
  if (titleIntent("Model Availability Changes") !== "retired")
    fail("Model Availability Changes title must be retired, got " + titleIntent("Model Availability Changes"));
  else if (titleIntent("FLUX.1 Pro Erase Now Available") !== "new")
    fail("Now Available launch must stay new, got " + titleIntent("FLUX.1 Pro Erase Now Available"));
  else ok("availability changes is retired; Now Available stays a launch");

  const info = classifyCard({
    id: "1423",
    title: "Model Availability Changes",
    date: "2026-11-04",
    category: "pricing-availability",
    text: "- Qwen Long 10M is no longer available.\n"
      + "- Imagen V3 is no longer available.\n"
      + "- MiMo V2.5 Pro and MiMo V2.5 Pro Thinking are deprecated. Their model IDs keep working, "
      + "but we recommend switching to [MiMo V2.6 Pro](https://nano-gpt.com/conversation?model=xiaomi%2Fmimo-v2.6-pro).\n\n"
      + "If your app uses Qwen Long 10M or Imagen V3, switch to an available model from the "
      + "[text model list](https://nano-gpt.com/models/text) or the Studio image models.",
  });
  if (info.intent !== "retired" || info.kind !== "retired" || info.skip)
    fail("availability+switch-to card must be retired, got intent=" + info.intent + " kind=" + info.kind + " skip=" + info.skip);
  else if (info.models.length !== 0)
    fail("switching-to link must not be a subject model, got " + JSON.stringify(info.models));
  else if (info.keys.some(k => /mimo-v2\.6-pro/i.test(k)))
    fail("replacement slug must not enter seen keys, got " + JSON.stringify(info.keys));
  else ok("availability change with switching-to link is Retired (not a MiMo launch)");
}

{
  // NanoGPT #1417: same availability title, no model links — subjects come from
  // body bullets (o3-mini / o4-mini / GPT-4 Turbo / Laguna / LLM Tech Decider).
  const info = classifyCard({
    id: "1417",
    title: "Model Availability Changes",
    date: "2026-11-02",
    category: "pricing-availability",
    text: "The following models are no longer available on NanoGPT:\n\n"
      + "- OpenAI o3-mini and o4-mini, including their High variants, and GPT-4 Turbo.\n"
      + "- Poolside Laguna S 2.1 and Laguna S 2.1 Thinking.\n"
      + "- LLM Tech Decider 0.8B, 2B and 4B, following LLM Tech's API shutdown.\n\n"
      + "If your app uses one of these model IDs, switch to an available model from the "
      + "[text model list](https://nano-gpt.com/models/text) or "
      + "[decision model list](https://nano-gpt.com/models/decisions). Perplexity PPLX Decider is unaffected.",
  });
  const subjects = availabilitySubjectTitles(info.title, info.description) || [];
  const line = groupPending([info])[0] && groupPending([info])[0].text;
  if (info.intent !== "retired" || info.kind !== "retired" || info.skip)
    fail("1417 availability card must be retired, got intent=" + info.intent + " kind=" + info.kind);
  else if (!subjects.some(s => /o3-mini/i.test(s)) || !subjects.some(s => /Laguna/i.test(s)) || !subjects.some(s => /Decider/i.test(s)))
    fail("1417 subjects must name o3-mini / Laguna / Decider, got " + JSON.stringify(subjects));
  else if (!line || !/^Retired:/.test(line) || !/o3-mini/i.test(line) || /New LLM/i.test(line))
    fail("1417 changelog line must be Retired naming o3-mini, got " + JSON.stringify(line));
  else ok("1417 availability card retires o3-mini/o4-mini + Laguna + Decider (not a launch)");
}

if (failed) {
  console.error("\n✗ check-title-intent-edges: " + failed + " failed");
  process.exit(1);
}
console.log("\n✓ check-title-intent-edges");
