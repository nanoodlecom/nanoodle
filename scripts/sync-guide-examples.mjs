#!/usr/bin/env node
// Render the static how-to hub + one page per reviewed gallery sample
// (plus Iron Verdict). No network or model calls. Share links are rebuilt
// from each sample's current workflow.json — the same bytes the gallery
// "Open workflow" buttons use.
//
//   node scripts/sync-guide-examples.mjs            # write guide/examples/*.html
//   node scripts/sync-guide-examples.mjs --check    # compare committed files
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(ROOT, "examples", "gallery");
const OUT = join(ROOT, "guide", "examples");
const SAMPLES = JSON.parse(readFileSync(join(GALLERY, "samples.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const textHtml = s => esc(s).replace(/[ \t]+$/gm, ws => [...ws].map(c => c === ' ' ? '&#32;' : '&#9;').join(''));

const local = (file) => {
  if (!/^[\w/-]+\.[\w]+$/.test(file) || file.includes("..") || !existsSync(join(GALLERY, file))) {
    throw new Error("Missing/invalid sample asset: " + file);
  }
  return file;
};

const formatCost = (usd, exact = true) =>
  `${exact ? "" : "at least "}$${Number(Number(usd).toFixed(5))}`;

const shareLink = (workflowBytes) =>
  "https://nanoodle.com/#g=" + gzipSync(workflowBytes).toString("base64url");

// How-to copy is grounded in samples.json notes, EXAMPLES comment nodes, and
// the awesome-noodles README / CURATION.md. Do not invent costs or model ids.
const HOWTO = {
  "character-sprites": {
    headline: "Game character kit",
    job: "Furnace knight. Reference + parts you can rig.",
    purpose: "GLM Flash writes the reference prompt; Muse paints the canonical character; Muse Edit cuts a four-quadrant parts sheet. Magenta backgrounds are for cutout. The companion skill bakes idle, walk, punch and jump frames locally. Iron Verdict is the worked playable game.",
    edit: "Rewrite <em>Character</em>. Leave <em>Character designer</em> on <code>z-ai/glm-5.3-flash</code>, <em>Canonical character</em> on <code>meta/muse-image/text-to-image</code> at 1:1, and <em>Rig parts</em> on <code>meta/muse-image/edit</code> at 1:1 unless you mean to change models. <em>Reference</em> is a local 768 fit.",
    inspect: "Furnace knight + four-quadrant parts.",
    costHow: "This saved run reported $0.02 for the two image calls ($0.01 reference + $0.01 parts) plus a small GLM Flash text call. Local resize is $0. Prices and results vary.",
  },
  "storyboard-relay": {
    headline: "Storyboard relay",
    job: "A story continues through a new frame, a continuity review and one visible revision.",
    purpose: "Muse draws the opening frame. Nano Banana receives it with the next beat and continuity rules, then stages the next event. Gemini compares both images. Muse Edit receives the draft, original frame, review and brief to make one revision; a fresh Gemini review then inspects the revised pixels. The opening, draft and revised frames remain available alongside the final notes.",
    edit: "Change <em>First scene</em>, <em>Next beat</em> and <em>Continuity rules</em> together. Describe a new action for the second frame and name the features that should survive it. Leave the review and repair instructions in place for the documented sequence. Every full run includes one repair attempt, followed by a fresh inspection.",
    inspect: "Compare the opening, draft and revised frames. Check whether the second scene advances the action and whether the repair preserves the character, important props and visual style. Read the final <em>Continuity notes</em> beside the revised picture; a repair can introduce new drift. This workflow makes one revision, with no automatic retry loop or guarantee that the result passes review.",
    costHow: "Five model calls: three image steps and two visual reviews. Image catalog rates checked on 12 September 2026 total $0.059; both reviews add token costs. The saved run's observed total appears above. Local fits preserve the frames without another model call.",
  },
  "tiny-world-film": {
    headline: "Tiny world, full soundtrack",
    job: "A miniature scene becomes a short film with sound drawn from its motion.",
    purpose: "Muse builds the first frame, Wan animates that image, and Mirelo adds foley from the generated video. The sound model receives the actual take, without the original world description. The graph outputs the first frame and film with foley. The saved sample also includes the intermediate silent take for comparison.",
    edit: "Change <em>World</em> and <em>Motion</em> together. Describe a clear miniature subject and one visible movement. The default animation requests 81 frames at 16 fps and 480p, about five seconds. Keep these settings for the documented short format.",
    inspect: "Compare <em>First frame</em> with <em>Silent take</em>, then play <em>Film with foley</em> with sound. Check that the scene remains recognizable, the requested motion happens and the sounds fit the visible events. Review the whole clip; exact synchronization, music and speech are not promised.",
    costHow: "Three model calls. Catalog rates checked on 12 September 2026 were $0.01 for the image, $0.20 for animation and $0.01 per second for foley, about $0.26 combined. Duration rounding and higher settings can change the total. The saved run's observed cost appears above.",
  },
  "image-model-arena": {
    headline: "Compare four image models",
    job: "One prompt → four images to compare.",
    purpose: "A shared bicycle-workshop poster brief branches into four image models. Compare the lettering, object count and tool shapes before choosing a result.",
    edit: "Rewrite <em>Shared test brief</em> once. All four image nodes receive it: Muse, GPT Image 2.5 Flare, Grok Imagine Image 2.0 and Recraft V4. Running the whole graph makes four paid image calls.",
    inspect: "Check FIX A FLAT, SATURDAY 10 AM, one wheel and two recognizable tire levers across all four results.",
    costHow: "The archived comparison reported $0.118: Muse $0.01, Krea $0.01, Grok $0.06 and Recraft $0.038. That total covers the saved Krea run. Check the editor estimate for the current models before running.",
  },
  "flux3-seedream-ideogram-arena": {
    headline: "FLUX.3 vs Seedream 5.0 vs Ideogram 4.5 vs Recraft V4.1 vs MOSS Image: same poster, side by side",
    job: "One midnight-ramen poster: FLUX.3, Seedream 5.0, Ideogram 4.5, Recraft V4.1 and MOSS Image.",
    purpose: "One brief splits to FLUX.3, Seedream 5.0 Flash, Ideogram V4.5, Recraft V4.1 Flash, and MOSS Image. Compare the heading, the footer, and whether the bowl stays alone.",
    edit: "Rewrite <em>Shared poster brief</em> once. FLUX.3 Image, Seedream 5.0 Flash, Ideogram V4.5, Recraft V4.1 Flash, and MOSS Image all receive it. Running the graph makes five paid image calls.",
    inspect: "Read MIDNIGHT BOWL and OPEN TIL 3 on each poster. One neon-red bowl. Extra words count.",
    costHow: "The saved runs reported $0.197: FLUX.3 $0.05, Seedream 5.0 Flash $0.027, Ideogram V4.5 $0.06, Recraft V4.1 Flash $0.008 (2026-10-05), and MOSS Image $0.052 (added 2026-10-19). Prices and results vary.",
  },
  "grok-heygen-minimax-video-arena": {
    headline: "Grok Imagine 1.5 Lite vs HeyGen Video 1 vs MiniMax H3: same prompt, side by side",
    job: "One night-ramen brief: Grok Imagine 1.5 Lite, HeyGen Video 1, and MiniMax H3.",
    purpose: "One brief splits to Grok Imagine Video 1.5 Lite, HeyGen Video 1, and MiniMax H3. Compare the noodle lift, the steam, and the wet asphalt.",
    edit: "Rewrite <em>Shared video brief</em> once. Grok Imagine 1.5 Lite, HeyGen Video 1, and MiniMax H3 all receive it. Running the graph makes three paid video calls.",
    inspect: "Play each clip. Grok fills the bowl and lifts a noodle clump. HeyGen starts emptier and drops a strand later. H3 does a single-chopstick / single-strand pull at 1440p.",
    costHow: "The saved run reported $0.563: Grok Imagine 1.5 Lite $0.10, HeyGen Video 1 $0.10, and MiniMax H3 $0.363. Prices and results vary.",
  },
  "idea-to-3d-model": {
    headline: "Idea to concept art to 3D model",
    job: "One object idea → an LLM concept description → a clean concept render → a textured GLB you can orbit.",
    purpose: "Image-to-3D models work best from one clear object on a plain background. An LLM writes the object's parts, materials, and colors; Join adds fixed 3D-ready render rules; Muse paints the concept; TRELLIS.2 turns that single image into a textured GLB. Inspired by <a href=\"https://x.com/patchmonkeydev/status/2109453424643428622\">@patchmonkeydev on X</a> (prompt → concept → multi-view → 3D in ComfyUI); only the idea is used.",
    edit: "Rewrite <em>Object idea</em> with one solid object (family-friendly). Keep the render rules if you want clean 3D: one whole object, plain background, no props. To trade price for detail, change the 3D model node's geometry resolution (512 / 1024 / 1536) or swap in Tripo 2.5 or Hunyuan. Running the graph makes one cheap text call, one image call, and one paid 3D call.",
    inspect: "Open the workflow and drag the 3D node to orbit the saved GLB. Check the sides the concept never showed: in the saved run the far side has portholes and a plainer cream strip, and the thin key and propeller blades go soft at some angles. The viewer shows flatter shading than the concept render.",
    costHow: "The saved sample reported about $0.21: TRELLIS.2 at $0.20 (1024 geometry), Muse text-to-image $0.01, and under $0.0001 for one GLM 5.3 Flash call. A concept-only test before the full run added about $0.01. Prices and results vary.",
  },
  "blockout-to-shot": {
    headline: "Blockout first, then the shot",
    job: "One action idea → a grayscale blockout still → a finished restyle that keeps the same poses and camera → one 5-second image-to-video shot.",
    purpose: "A Blender-style blockout (gray untextured stand-ins, readable silhouettes, explicit camera) gives the image and video models a blueprint. An LLM writes the blockout prompt; Muse paints it. A second LLM writes a look bible, Join puts a keep-composition line in front of it, and Muse Edit restyles materials and lighting while keeping the layout. A third LLM writes a short motion brief; Seedance 1.5 Pro animates the finished still. One look and one action throughout. Inspired by <a href=\"https://x.com/ComfyUI/status/2107848762957983856\">ComfyUI on X</a> (blockout then restyle); only the idea is used.",
    edit: "Rewrite <em>Action idea</em> with clear poses and one camera path (family-friendly). To change the finished look, edit the Look bible system prompt or swap the Edit model. To change motion, edit the Motion brief system prompt or swap the Image → Video model. Keep resolution and duration matched if you swap video models. Running the graph makes three cheap text calls, one image call, one edit call, and one paid video call.",
    inspect: "Compare the blockout still to the finished still: the rooftops, the robot's mid-leap pose, and the camera should match. Then scrub the clip. In the saved run the robot clears the gap and lands on the far roof, but it also spins sideways in mid-air, skips the crouch, and keeps rolling while the camera swings behind it.",
    costHow: "The saved sample reported about $0.15: Seedance 1.5 Pro at $0.13 (720p, 5 s, audio off), Muse text-to-image $0.01, Muse Edit $0.01, and about $0.0002 for three GLM 5.3 Flash calls. Join nodes are free. Prices and results vary.",
  },
  "story-to-shot": {
    headline: "Write a story. H3 picks the shots.",
    job: "Turn a short story into one 5-second clip without writing camera angles.",
    purpose: "Shows a cheap LLM keeping prose free of camera jargon, then MiniMax H3 inventing the framing — the same story-mode trick people are testing in ComfyUI.",
    edit: "Rewrite <em>Story</em> with a new short, family-friendly scene (one hero, one clear action). Keep <em>Story-mode rules</em> and the Keep it a story LLM so the model stays SFW and invents its own camera. Change duration on the video node if you want a longer take (cost scales).",
    inspect: "Watch whether H3 invents sensible cuts for the beats you wrote. Check that the hero and prop stay consistent across the clip. Look for missing story beats (mailbox vs door) and any unrequested props.",
    costHow: "One GLM 5.3 Flash call plus one MiniMax H3 text-to-video call. The saved run was about $0.36 for 5 seconds of H3 (LLM was a fraction of a cent). Longer durations raise the price.",
  },
  "orbit-the-character": {
    headline: "One still. Orbit to a new side.",
    job: "Turn one character still into a short orbit that shows the same subject from new angles.",
    purpose: "Shows MiniMax H3 Max Multi Angle's orbit-right camera control on a SFW paper-craft subject — the multi-angle character trick people share from ComfyUI, without anime-girl defaults.",
    edit: "Rewrite <em>Character seed</em> with a new SFW physical toy or paper subject (full body, fixed three-quarter view). Keep <em>Still rules</em>, the Join → GLM still-prompt path, and the Multi Angle node on orbit-right. Try orbit-left or rise in modelOpts if you want a different turn.",
    inspect: "Watch whether identity (scarf, boat, paper folds) holds across the orbit. Check that the subject stays centered and that the ending angle is a real new side, not a morph. Look for background invention and prop drift.",
    costHow: "One GLM 5.3 Flash call, one Muse 1:1 still (~$0.01), and one H3 Max Multi Angle 5 s 480p call ($0.25). The saved run was about $0.26 total. Longer durations or higher resolutions raise the price.",
  },
  "same-shot-three-looks": {
    headline: "Same shot, three looks",
    job: "Lock one composition, then climb a style ladder with Muse Edit.",
    purpose: "Show that chained image edits can keep framing while swapping materials — glass, watercolor, photoreal — without redrawing the scene from scratch.",
    edit: "Rewrite <em>Glass look prompt</em> with another SFW still-life (fixed camera, clear props). Keep <em>Watercolor edit</em> and <em>Photoreal edit</em> as preserve-composition restyles, and keep <em>Morph motion</em> on the Seedance clip if you want ambience — or disconnect that video node for a stills-only ladder.",
    inspect: "Compare the three stills side by side: same rocks, cage/lantern, moon placement. The watercolor should read as paper; photoreal as a photo. Treat the Seedance clip as optional ambience (<em>Morph motion</em> often drifts into sparkles rather than a clean material morph).",
    costHow: "This saved run was about $0.16 (three Muse calls ~$0.033 + Seedance ~$0.13). Stills alone are ~$0.03.",
  },
  "mix-the-references": {
    headline: "Mix the references",
    job: "Compose one picture from separate who / wear / hold / where references.",
    purpose: "Show multi-reference compositing: one Edit node takes several images in port order, and the instruction addresses each by number (image 1 is the character, image 2 the outfit…), so each part comes from its own source instead of a long prompt.",
    edit: "Each reference has its own prompt: <em>Who · character</em>, <em>What they wear · outfit</em>, <em>What they hold · prop</em> and <em>Where · place</em>. Rewrite any of them, or replace its Image node with a 📷 Image input and drop in your own photo (a product, a mascot, a jacket, a room). Keep the wiring order and update the matching “Image N is…” line in <em>Mix instruction (names each image)</em>. Klein takes up to 10 references: wire image5 and name it the same way.",
    inspect: "Check each reference against the mix: same fox colors and face, same coat and toggles, exactly one lantern, same pier and lighthouse. Look for parts that drop out (here the paper boats) and parts that change shape (the coat got longer).",
    costHow: "Four Muse 1:1 stills at $0.011 each and one FLUX.3 Klein Edit 1024×1024 at $0.009. The saved run was $0.053. With your own uploads instead of the Muse stills it is about $0.01.",
  },
  "color-to-manga": {
    headline: "Color art to a printed manga panel",
    job: "Turn a color illustration into a black-and-white manga panel with ink, solid blacks and screentone.",
    purpose: "Show a production-step edit: the same picture redrawn for black-and-white print. Composition stays put and only the rendering changes: color becomes line art, solid black fills and dot tones.",
    edit: "Rewrite <em>Color art · prompt</em> for a different scene, or replace the Muse node with a 📷 Image input and drop in your own color art. <em>Manga conversion · instruction</em> holds the ink rules (line weight, which areas go solid black, how dense the dots get). Change them for a lighter or heavier tone pass.",
    inspect: "Put the two images side by side. Check that every object is still in the same place, that the darkest areas went solid black, that mid-tones became dots rather than smooth grey, and that highlights stayed white. Zoom in: the dots here are drawn by the model, not a regular halftone grid.",
    costHow: "One Muse 3:4 still at $0.011 and one Qwen Image 2.1 Edit at 1k for $0.03. The saved run was $0.041. With your own art in place of the Muse still it is $0.03.",
  },
  "bilingual-tea-poster": {
    headline: "Event details to a bilingual poster",
    job: "Turn three lines of event details into a poster lettered in Chinese and English.",
    purpose: "Show what MOSS Image does best: exact text in two scripts, placed where the brief says. The LLM writes every line to print in quotes, with its position; MOSS letters them.",
    edit: "Rewrite <em>Event details</em> and ▶ Run. <em>Bilingual poster brief</em> holds the copywriting rules (headline length, which lines, no people or logos). The MOSS node carries a Negative prompt; Steps, Guidance and Prompt expansion are under ⚙️ Model options and stay at the model defaults when blank.",
    inspect: "Read every printed line against the brief, character by character, in both scripts. Look for extra words, a dropped line, or text in the wrong place.",
    costHow: "One GLM 5.3 Flash call for $0.0002 and one MOSS Image call at 1024×1536 for $0.079. The saved run was $0.079. At MOSS's default 1024×1024 it is about $0.053, and at 512×512 about $0.013.",
  },
  "day-to-night": {
    headline: "Day to night between two keyframes",
    job: "Make a clip that starts on one still and ends on another, here midday to night.",
    purpose: "Show start + end frame video: an Image→Video node with an end-frame port. The model has to get from the first image to the second, so you choose both ends of the shot and it fills in the change between them.",
    edit: "Rewrite <em>Day keyframe · prompt</em> for a different place, and <em>Night keyframe · instruction</em> for a different change (winter, a storm, a finished room). Keep \"same camera, same framing\" in the instruction so the two frames line up. Or swap either Image node for a 📷 Image input to use your own before and after. <em>Transition · motion prompt</em> describes what happens in between.",
    inspect: "Check that the first frame matches the day still and the last frame matches the night still, and that nothing jumps in between. Watch for materials that change mid-clip (here the paper waves turn into real water) and for details that pop in late instead of fading in (here the moon and stars).",
    costHow: "Muse 16:9 $0.011 + Muse Edit 16:9 $0.011 + MiniMax H3 Max at 768p for 5 s, $0.40. The saved run was $0.422. Set the video node to 480p for about $0.25.",
  },
  "product-photo-to-hero-ad": {
    headline: "Product photo to a hero ad",
    job: "Turn one plain product photo into an ad shot: placed in a scene, retouched where it went wrong, and moving.",
    purpose: "Show a small commercial pipeline: an Edit node places the product and is told to keep it identical, an Inpaint node changes only a brushed area so you can fix one mistake without rerolling the whole scene, and Image→Video adds one slow camera move whose last frame doubles as the hero still.",
    edit: "Rewrite <em>Product photo · prompt</em> for your product, or swap the packshot Image node for a 📷 Image input with your own product on a plain background. Rewrite <em>Placement · instruction</em> for your setting, and keep its \"keep the product identical\" lines. Run up to the scene and look for what went wrong, then brush that area on the Inpaint node (or replace <em>Mask · white = repaint</em>) and say what belongs there in <em>Fix · what goes in the mask</em>. <em>Hero move · look + motion</em> sets the look and the camera move.",
    inspect: "Compare the placed product with your packshot: shape, color, handles and any parts the model may have duplicated or merged (here the saucer turned up twice). After the fix, check that only the brushed area changed. In the clip, watch the product's shape through the orbit and look for things that appear from nowhere (here a falling drop at about 2 s).",
    costHow: "Muse 1:1 $0.011 + Muse Edit 16:9 $0.011 + Nano Banana Edit inpaint $0.039 + Seedance 1.5 Pro 720p 5 s without audio, reported $0.13 (the catalog estimate is about $0.08). Video → frames is free. The saved run was $0.191. With your own product photo, skip the Muse packshot.",
  },
  "three-references-one-clip": {
    headline: "Three references, one clip",
    job: "Put a specific character, prop and place into one video clip and keep all three looking like your references.",
    purpose: "Show reference-to-video: instead of starting from one first frame, the Text→Video node takes several reference images on its ref ports and the model builds a new shot that contains all of them, so one character design can be reused across many different shots.",
    edit: "Rewrite <em>Ref 1 · character</em>, <em>Ref 2 · prop</em> and <em>Ref 3 · place</em> for your own subjects, keeping the same \"Look:\" line at the start of each so they share one style, or swap any Image node for a 📷 Image input with your own picture. In <em>Shot · look + action</em>, refer to them as image 1, image 2 and image 3 and describe one simple action. You can wire up to nine references.",
    inspect: "Check each reference in the clip: the character's face, clothes and colors, the prop's shape and color, and whether the setting matches the place still. Then check framing: here the model kept the hedgehog at the left edge and panned away instead of following the prompt.",
    costHow: "Three Muse stills at $0.011 each + H3 Reference-to-Video at 540p for 5 s, reported $0.435 (the 540p rate of $0.075/s is $0.375; the rest matches about $0.02 per reference image). The saved run was $0.468. With your own reference pictures, skip the Muse stills.",
  },
  "seamless-loop": {
    headline: "One still, a seamless loop",
    job: "Turn one picture into a short clip that loops without a visible cut, for a background, a banner or a social post.",
    purpose: "Show the endframe port: on video models that take an end image, an Image→Video node grows an end frame port. Wiring the same still into both the image and end frame ports forces the clip to finish where it started, so it plays as a loop.",
    edit: "Rewrite <em>Scene · prompt</em> for your own scene, or swap the Image node for a 📷 Image input with your own picture. In <em>Loop · motion prompt</em> keep the camera locked off and describe motion that can come back to where it began: things that turn, sway, bob, flicker or flow. Avoid anything that enters or leaves the frame.",
    inspect: "Play the clip on repeat and watch the loop point. Compare the last frame with the first: here they differ by about as much as two neighbouring frames, but the motion slows into the seam, so there is a faint tick in the sails if you look for it.",
    costHow: "One Muse still at $0.011 + H3 Max Turbo at 768p for 5 s at $0.04/s = $0.20. The saved run was $0.211. At 480p the clip is $0.125; at 1080p, $0.40.",
  },
  "add-snow-to-a-clip": {
    headline: "Add snow to a clip",
    job: "Change the weather in a clip you already have, without reshooting or re-animating it.",
    purpose: "Show the Video edit node used as a VFX pass: a video-to-video model takes a finished clip plus one plain-language instruction and returns the same shot with the change, keeping the camera move, framing and timing.",
    edit: "To try it as is, rewrite <em>Scene · prompt</em> and <em>Plain clip · motion prompt</em> for a calm shot of your own. To edit a clip you already have, replace the first three nodes with a 📹 Video input holding it (under 15 s). Then rewrite <em>Effect · edit instruction</em>: say what to add and end with what must stay the same. Try rain, fog, autumn leaves or a different time of day.",
    inspect: "Play the plain clip and the edited clip side by side. Check the camera move and timing match, that the new weather sits on the right surfaces, and whether anything is actually moving: here the snow is settled from the first frame and no flakes fall.",
    costHow: "One Muse still at $0.011 + H3 Max Turbo at 480p for 5 s at $0.025/s = $0.125 + FLUX.3 Edit Video at $0.051 per second of source, billed here as 6 s = $0.306. The saved run was $0.442. With your own clip, you pay only the edit.",
  },
  "logo-pile": {
    headline: "Logo to a 3D pile, cut out",
    job: "Turn a flat logo into a 3D hero graphic, a heap of the logo as physical objects, on a transparent background for a slide, a banner or a launch post.",
    purpose: "Chain two Edit nodes: the first restyles the picture (flat logo to 3D pile), the second uses a background-removal model with a short prompt naming what to keep, so the result comes out as a transparent PNG.",
    edit: "Describe a different mark in <em>Logo · prompt</em>, or swap the FLUX.3 Klein node for a 📷 Image input with your own logo, ideally on a plain background. In <em>Pile · instruction</em> change the count, the material (glossy plastic, metal, wood) or the angle; keep \"exact copy of this logo\" and \"plain background\" so the cutout step has an easy job. If your logo is not a badge, change \"the pile of 3D logo badges\" in <em>Keep · what to cut out</em> to match.",
    inspect: "Compare the copies in the pile with the flat logo: colors and shape hold, but look for simplified or mirrored marks. Open the cutout on a dark background to check the edges; the contact shadows are gone, so add your own if it looks like it floats.",
    costHow: "FLUX.3 Klein at 1024² for $0.009 + Qwen Image 2.1 Edit at 1k for $0.03 + Bria guided cutout for $0.03 = $0.069. With your own logo the first step is free, so it is $0.06.",
  },
  "radio-play": {
    headline: "Radio play: two voices, one Speech node",
    job: "Make a short two-person audio scene, a radio play, an explainer dialogue or a podcast-style intro, without recording anyone.",
    purpose: "Show that one Speech node can do a conversation: Gemini 3.1 Flash TTS reads a \"conversation between A and B\" with a cast note that assigns a voice to each name, and does not read the names aloud.",
    edit: "Rewrite <em>Story idea</em>, and change the two names in the idea, the Script node's system prompt and <em>Cast · voice direction</em>. Keep the cast note's opening (\"TTS the following conversation between …\") and the \"Do not read the speaker names aloud\" line; rewording it can collapse everything into one voice. Describe the two voices so they contrast (deep and calm against bright and young).",
    inspect: "Listen for the switch at every line, and for names being read out. If both characters sound the same, put the cast note back to the wording here and run the Speech node again.",
    costHow: "GLM 5.3 Flash for under $0.001 + Gemini 3.1 Flash TTS at about $0.10 per 1,000 characters (cast note plus script, about 950 characters here) = about $0.10. The saved run was about $0.098 by balance; the TTS price is not reported per call.",
  },
  "swap-the-character": {
    headline: "Swap the character, keep the performance",
    job: "Recast a clip: keep someone's dance, gesture or walk, the camera move and the location, but have a different character perform it, from just one picture of that character.",
    purpose: "The Video edit node grows a <em>character</em> image port when you pick an image+video model like Wan 2.2 Animate. Wire the performance clip into <em>video</em> and the character still into <em>character</em>, and set the model's mode to <em>replace</em> so the character is placed into the original scene. (<em>animate</em> mode instead moves your still, with its own background.)",
    edit: "Change the performer in <em>Dancer · prompt</em> and the dance in <em>Performance · motion prompt</em>, or delete those nodes and wire a 📹 Video input with your own clip into Video edit. Describe a different character in <em>New character · prompt</em>, or wire a 📷 Image input into the character port. Use a full-body character on a plain background, at the same aspect ratio as the clip, with the pose roughly matching the performer's first frame.",
    inspect: "Play the two clips side by side and step through the spin: the moves and camera should match beat for beat. Check whether the character kept its proportions and details (here the fox grows to the dancer's height and loses most of its tail), and look at fast turns for smearing.",
    costHow: "Two Muse stills at $0.011 each + H3 Max Turbo 480p 5 s for $0.125 + Wan 2.2 Animate replace at 480p for $0.30 (it billed 6 s at $0.05/s for the 5.18 s clip) = $0.447. With your own clip and character image only the swap is paid: about $0.05 per second at 480p.",
  },
  "carve-a-pumpkin": {
    headline: "Carve a design into a pumpkin",
    job: "Turn a flat design into a carved pumpkin, and then into a clip of it being carved.",
    purpose: "Show a clean-plate trick for start + end frame video. You make the finished look first, then an edit node removes the change, and the Image→Video node travels from the clean plate back to the finished still. Both ends of the shot match because one image was made from the other.",
    edit: "Rewrite <em>Stencil · prompt</em> for your own design and keep \"flat black shapes, no thin lines\" so it carves cleanly, or swap the stencil node for a 📷 Image input. Change the scene in <em>Carve · instruction</em> (a wooden sign, a cake, a sand sculpture) and keep <em>Clean plate · instruction</em> asking for the same camera and framing. <em>Carving · motion prompt</em> describes how the change happens.",
    inspect: "Check that the carved still keeps the stencil's shapes (Muse Edit lost them here, Nano Banana Edit kept them), that the clean plate matches the carved still apart from the carving, and that the clip's first and last frames match the two stills.",
    costHow: "Muse 1:1 $0.011 + Nano Banana Edit $0.039 + Muse Edit 16:9 $0.011 + MiniMax H3 Max Turbo at 480p for 5 s, $0.125. The saved run was $0.186.",
  },
  "creator-ad": {
    headline: "A creator ad for your product",
    job: "Turn a product and a two-line brief into a vertical, creator-style talking ad.",
    purpose: "Show how to chain a reference mix into a talking avatar. Muse Edit makes one frame with the creator holding the product, an LLM turns the brief into a short spoken script, and LongCat Avatar animates that frame to the voice, so the product stays in her hand for the whole ad.",
    edit: "Rewrite <em>Product · stand-in</em> for your product, or swap the <em>Product shot</em> Image for a 📷 Image input with your own product photo. Put what it really does in <em>Product brief</em>, because the script only claims what the brief says. Change <em>Creator · look</em> for a different invented creator or setting, keep \"face and mouth fully visible\" in <em>Hold the product · instruction</em> so the lip sync has a clear mouth, and set the tone in <em>Delivery</em>. Pick another voice on the <em>Voice</em> node.",
    inspect: "Check that the selfie frame keeps your product's shape and details and doesn't cover her mouth, read the script for claims the brief doesn't make, and watch the ad with sound to judge the lip sync and whether the product stays steady.",
    costHow: "Muse 1:1 $0.011 + Muse 9:16 $0.011 + Muse Edit 9:16 $0.011 + GLM 5.3 Flash under $0.001 + MiniMax Speech about $0.02 + LongCat Avatar 1.5 at $0.04 per second of voice at 480p, billed in whole seconds ($0.56 for 14 s). The saved run was $0.614. LongCat's estimate in the editor assumes 5 s, so a longer script costs more than it shows.",
  },
  "photo-to-video": {
    headline: "Animate a still",
    job: "Generate a first frame, then animate its steam.",
    purpose: "Muse draws a mug of tea beside a notebook. MiniMax H3 uses that first frame and a separate motion brief to make a five-second clip. Keeping the scene and movement in separate inputs lets you change what moves without redesigning the still.",
    edit: "Change <em>Still brief</em> and <em>Motion brief</em> to describe the same scene. Muse generates the first frame; MiniMax H3 animates it for five seconds at 480p.",
    inspect: "Play the clip. The mug, notebook and desk should stay stable while the steam moves. Check the full clip before using it.",
    costHow: "The saved tea-mug run reported $0.261 on 23 October 2026: the Muse still plus five seconds of MiniMax H3 image-to-video at 480p. Prices and results vary.",
  },
  sing: {
    headline: "Sing: trip-hop about the singularity",
    job: "Idea + favorite bands → lyrics, arrangement and song.",
    purpose: "Start with a wistful 90s trip-hop song about the singularity and musical references: Portishead, Massive Attack and Tricky. GLM Flash writes lyrics, then an arrangement fitted to those words, then an avoid-list grounded in that arrangement. MiniMax Music 3 receives the lyrics separately from the combined musical direction. Changing the references steers the groove, instruments and vocal delivery.",
    edit: "Rewrite <em>Song idea</em> and <em>Preferred bands</em>. Inspect <em>Write lyrics</em>, <em>Arrange the song</em> and <em>What would clash?</em> before running <em>Sing</em>, or run the whole graph. The references become descriptions of sound, without artist names in the music prompt.",
    inspect: "Read the generated lyrics, arrangement and avoid-list below, then listen for the hook, groove and vocal delivery. Musical direction guides the result; exact structure and duration are not guaranteed.",
    costHow: "The saved run reports its generation cost below. Three text calls prepare the lyrics, arrangement and avoid-list; one MiniMax Music 3 call makes the song. Check the editor estimate before running.",
  },
  "talking-avatar": {
    headline: "Make a speaking presenter",
    job: "Portrait + spoken script → lipsynced introduction.",
    purpose: "Muse generates a fictional museum guide while MiniMax Speech reads the workshop introduction. LongCat combines the portrait and speech into a video, using a delivery brief to control movement. The two branches let you change the presenter and the spoken words independently.",
    edit: "Change <em>Presenter look</em>, <em>Spoken script</em> and <em>Delivery</em>. Keep the face and mouth visible, match the selected voice to the presenter, and keep the script under 30 seconds. LongCat renders at 480p.",
    inspect: "Play with sound. Check the spoken words, face consistency and lip-sync timing through the whole clip.",
    costHow: "The saved workshop run reported at least $0.28 for generation; some provider price fields were missing. Its separate model-assisted audio review reported $0.00164. Longer speech increases video cost. Check the editor estimate before running.",
  },
  "neon-shrine-duel": {
    headline: "Neon shrine duel",
    job: "A fight seed becomes an Anima still, then a five-second H3 Max clash.",
    purpose: "GLM Flash writes an Anima keyframe prompt from the seed. Anima paints the still. A second GLM call writes a locked-camera H3 Max motion prompt so both fighters stay framed. MiniMax H3 Max animates the still for five seconds at 480p.",
    edit: "Rewrite <em>Fight seed</em>. Leave <em>Still prompt</em> and <em>Motion prompt</em> on <code>z-ai/glm-5.3-flash</code>, <em>Fight still</em> on <code>anima/text-to-image</code>, and <em>Clash clip</em> on <code>minimax/h3-max</code> at 480p / 5s unless you mean to change models.",
    inspect: "Play the clip. Both fighters should stay readable through the overhead cut. Watch for whip-pans or an empty end frame.",
    costHow: "The saved run reported about $0.27: roughly $0.01 for the Anima still and $0.25 for five seconds of H3 Max video at 480p, plus small GLM Flash text calls. Prices and results vary.",
  },
};

// Awesome-noodles README share link for character-sprites (Iron Verdict is
// not a samples.json entry). Do not invent a second link.
const IRON = {
  slug: "iron-verdict",
  title: "Iron Verdict",
  headline: "Iron Verdict",
  job: "Character brief → reference → parts → local rig.",
  costLabel: "$0.02 combined (selected source images)",
  review: "Playable experiment",
  date: "2026-09-05",
  models: ["z-ai/glm-5.3-flash", "meta/muse-image/text-to-image", "meta/muse-image/edit"],
  open: readFileSync(join(ROOT, "scripts", "fixtures", "iron-verdict-open-url.txt"), "utf8").trim(),
  play: "https://nanoodle.com/examples/iron-verdict/",
  skill: "https://github.com/nanoodlecom/noodle-skills/tree/main/skills/character-sprites",
  graph: "https://github.com/nanoodlecom/awesome-noodles/blob/main/graphs/character-sprites.noodle-graph.json",
  zip: "/examples/iron-verdict/iron-verdict.zip",
  preview: "/examples/iron-verdict/screenshot.png",
  purpose: "The graph turns a character brief into a reference image and a matching four-quadrant parts sheet. The companion character-sprites skill extracts the parts and bakes 32 transparent animation frames locally. A coding agent used those assets to build Iron Verdict, the playable three-round fighter shown here.",
  edit: "Open the artwork graph and rewrite <em>Character</em>. GLM Flash writes the reference prompt, Muse draws the character, and Muse Edit makes matching parts. Use the companion skill with Node.js and ffmpeg to rig and bake idle, walk, punch and jump frames. Building a game around them requires separate coding work.",
  inspect: "Inspect the cutout joints and animation frames, then play the game to judge how they move. This prototype uses rigid limbs.",
  costHow: "The selected source images cost $0.02 combined ($0.01 each for reference and parts). Local baking and playtesting made no further model calls. Your own character spends your NanoGPT balance; the skill has the full run.",
};

const ORDER = ["storyboard-relay", "tiny-world-film", "iron-verdict", "character-sprites", "image-model-arena", "flux3-seedream-ideogram-arena", "grok-heygen-minimax-video-arena", "carve-a-pumpkin", "creator-ad", "swap-the-character", "radio-play", "logo-pile", "add-snow-to-a-clip", "seamless-loop", "three-references-one-clip", "product-photo-to-hero-ad", "bilingual-tea-poster", "day-to-night", "color-to-manga", "mix-the-references", "same-shot-three-looks", "orbit-the-character", "story-to-shot", "blockout-to-shot", "idea-to-3d-model", "photo-to-video", "sing", "talking-avatar", "neon-shrine-duel"];

// Per-page share cards composed from the saved gallery outputs (1200×630 PNG).
// Other guide pages keep the site-wide og-card.
const DEFAULT_SHARE = {
  image: "https://nanoodle.com/og-card.png",
  alt: "Neon noodles rising from a ramen bowl into glowing workflow cables, with the nanoodle logo",
};
const SHARE_CARDS = {
  "flux3-seedream-ideogram-arena": {
    path: "/examples/gallery/flux3-seedream-ideogram-arena/og.png",
    alt: "Five saved midnight-ramen posters side by side: FLUX.3, Seedream 5.0, Ideogram 4.5, Recraft V4.1, and MOSS Image",
  },
  "grok-heygen-minimax-video-arena": {
    path: "/examples/gallery/grok-heygen-minimax-video-arena/og.png",
    alt: "Three saved night-ramen video frames side by side: Grok Imagine 1.5 Lite lifting a noodle clump, HeyGen Video 1 lifting noodles, and MiniMax H3 lifting one strand",
  },
};

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Share card is not a PNG: " + file);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function shareFor(slug) {
  const card = SHARE_CARDS[slug];
  if (!card) return DEFAULT_SHARE;
  const file = join(ROOT, card.path.slice(1));
  if (!existsSync(file)) throw new Error("Missing share card: " + card.path);
  const { width, height } = pngSize(file);
  if (width !== 1200 || height !== 630) {
    throw new Error(`Share card ${card.path} is ${width}×${height}, expected 1200×630`);
  }
  return { image: "https://nanoodle.com" + card.path, alt: card.alt };
}

for (const sample of SAMPLES) {
  if (!HOWTO[sample.slug]) throw new Error("Unexpected sample: " + sample.slug);
}
for (const slug of Object.keys(HOWTO)) {
  if (!SAMPLES.some((sample) => sample.slug === slug)) throw new Error("Missing saved sample: " + slug);
}

function chrome({ title, description, path, crumbs, wide, body, next, share }) {
  const url = "https://nanoodle.com" + path;
  const card = share || DEFAULT_SHARE;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="nanoodle" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(card.image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(card.alt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(card.image)}" />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0b0d12" />
<link rel="canonical" href="${esc(url)}" />
<link rel="stylesheet" href="/guide/guide.css" />
</head>
<body>
<div class="wrap${wide ? " wide" : ""}">

  <header>
    <a class="logo" href="/"><span class="nano">NaNo</span>odle</a>
    <div class="spacer"></div>
    <a class="ghost" href="/">Open editor →</a>
  </header>

  <nav class="crumbs">${crumbs}</nav>

  <main>
${body}
      <nav class="next">
${next}
      </nav>
    </section>
  </main>

  <footer>
    <span>Made with <a href="https://nano-gpt.com/r/mgzwtqjw" target="_blank" rel="noopener">NanoGPT</a></span>
    <span>· No analytics · Your key stays on your device</span>
    <div class="spacer"></div>
    <a href="https://github.com/nanoodlecom/nanoodle" target="_blank" rel="noopener">GitHub</a>
    <a href="https://www.reddit.com/user/dividebynano" target="_blank" rel="noopener">Contact</a>
    <a href="/">Home</a>
  </footer>

</div>
</body>
</html>
`.replace(/[ \t]+$/gm, "");
}

function sampleBySlug(slug) {
  return SAMPLES.find((s) => s.slug === slug);
}

function howTitle(slug) {
  if (slug === "iron-verdict") return IRON.headline || IRON.title;
  const how = HOWTO[slug];
  return (how && how.headline) || sampleBySlug(slug).title;
}

function cardForSample(s) {
  const how = HOWTO[s.slug];
  const cost = formatCost(s.costUsd, s.costExact);
  const href = `/guide/examples/${esc(s.slug)}`;
  let thumb;
  if (s.preview) {
    thumb = `<img class="thumb" src="/examples/gallery/${esc(local(s.preview))}" alt="" loading="lazy" />`;
  } else if (s.outputs.some((o) => o.kind === "image")) {
    const img = s.outputs.find((o) => o.kind === "image");
    thumb = `<img class="thumb" src="/examples/gallery/${esc(local(img.src))}" alt="" loading="lazy" />`;
  } else {
    thumb = `<div class="thumb-fallback">No preview image — open for the reviewed ${s.outputs[0].kind} output</div>`;
  }
  return `<a class="howto-card" href="${href}">
        ${thumb}
        <span class="body">
          <b>${esc(how.headline || s.title)}</b>
          <span class="job">${esc(how.job)}</span>
          <span class="cost">Reported saved run: ${esc(cost)}</span>
        </span>
      </a>`;
}

function ironCard() {
  return `<a class="howto-card" href="/guide/examples/iron-verdict">
        <img class="thumb" src="${esc(IRON.preview)}" alt="" loading="lazy" />
        <span class="body">
          <b>${esc(IRON.title)}</b>
          <span class="job">${esc(IRON.job)}</span>
          <span class="cost">${esc(IRON.costLabel)}</span>
        </span>
      </a>`;
}

function visibleOutputs(s) {
  const note = String(s.note || "").trim();
  return s.outputs.filter((o) => {
    if (/NOTE\.txt$/i.test(o.src)) return false;
    if (o.kind !== "text") return true;
    return readFileSync(join(GALLERY, local(o.src)), "utf8").trim() !== note;
  });
}

function renderMedia(s, how) {
  const shown = visibleOutputs(s);
  const multi = s.layout === "sequence" ? " sequence" : shown.length > 1 ? " comparison" : "";
  const aria = (how && how.headline) || s.title;
  const figures = shown.map((o) => {
    const src = "/examples/gallery/" + local(o.src);
    if (o.kind === "text") {
      const text = readFileSync(join(GALLERY, local(o.src)), "utf8");
      const body = `<blockquote class="sample">${textHtml(text)}</blockquote>`;
      const content = (o.spoiler || o.collapsed) ? `<details><summary>${esc(o.label)}</summary>${body}</details>` : body;
      return `<figure${s.layout === "sequence" ? ' class="sequence-text"' : ""}>${content}<figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "video") {
      const poster = s.preview ? ` poster="/examples/gallery/${esc(local(s.preview))}"` : "";
      return `<figure><video controls playsinline${o.loop ? " loop" : ""} preload="none"${poster} aria-label="${esc(o.label + ' — ' + aria)}"><source src="${esc(src)}" type="video/mp4"></video><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    if (o.kind === "audio") {
      return `<figure><audio controls preload="none" aria-label="${esc(aria)}"><source src="${esc(src)}" type="audio/mpeg"></audio><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
    }
    return `<figure><a href="${esc(src)}"><img src="${esc(src)}" alt="${esc(o.label + " — " + aria)}" loading="lazy" /></a><figcaption>${esc(o.label)} · <a href="${esc(src)}" download>Download</a></figcaption></figure>`;
  }).join("\n          ");
  const note = !s.preview && shown.every((o) => o.kind === "audio" || o.kind === "text") && shown.length
    ? `<p class="no-preview">No preview image was saved for this sample. The reviewed output is the ${shown.map((o) => o.kind).join(" and ")} below.</p>`
    : "";
  const cover = s.preview && shown.every((o) => o.kind === "audio" || o.kind === "text")
    ? `<div class="media">
          <figure><a href="/examples/gallery/${esc(local(s.preview))}"><img src="/examples/gallery/${esc(local(s.preview))}" alt="${esc(aria)}" loading="lazy" /></a><figcaption>Cover still · <a href="/examples/gallery/${esc(local(s.preview))}" download>Download</a></figcaption></figure>
        </div>
        `
    : "";
  return `${note}${cover}<div class="media${multi}">
          ${figures}
        </div>`;
}

function renderAlternates(s) {
  return (s.alternates || []).map(a => {
    const graph = readFileSync(join(GALLERY, local(a.graph)));
    if (createHash('sha256').update(graph).digest('hex') !== a.graphSha256) {
      throw new Error('Alternate graph changed: ' + a.graph);
    }
    return `<details class="alternate" id="${esc(s.slug + '--' + a.id)}"><summary><span class="alternate-summary"><img src="/examples/gallery/${esc(local(a.preview))}" alt="" loading="lazy"><span><b>Another run: ${esc(a.title)}</b><span>See what the same workflow made with different inputs ↓</span></span></span></summary>
      <div class="alternate-body"><p class="howto-note">${esc(a.review)} · ${esc(a.date)} · Reported saved run: ${esc(formatCost(a.costUsd, a.costExact))}.</p>
      <p>${esc(a.note)}</p>${renderMedia(a)}
      <details><summary>Inputs for this version</summary>${a.inputs.map(i => `<h3>${esc(i.label)}</h3><p>${esc(i.text)}</p>`).join('')}<p class="howto-note">Sampled models: ${a.models.map(esc).join(', ')}.</p></details>
      <p class="cta"><a class="secondary" href="${esc(shareLink(graph))}">Open this version →</a><a href="/examples/gallery/${esc(local(a.graph))}" download>Download this version</a><a href="/examples/gallery/${esc(local(a.sourceRun))}">Run record</a></p></div></details>`;
  }).join('\n');
}

function samplePage(s, prev, next) {
  const how = HOWTO[s.slug];
  const graph = readFileSync(join(GALLERY, local(s.slug + "/graph.json")));
  if (createHash("sha256").update(graph).digest("hex") !== s.graphSha256) {
    throw new Error("Sample graph changed: " + s.slug);
  }
  const workflow = readFileSync(join(GALLERY, local(s.workflow)));
  if (createHash("sha256").update(workflow).digest("hex") !== s.workflowSha256) {
    throw new Error("Workflow changed: " + s.slug);
  }
  const open = shareLink(workflow);
  const gallery = `/examples/gallery/#${s.slug}`;
  const cost = formatCost(s.costUsd, s.costExact);
  const title = how.headline || s.title;
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Steal a noodle</a> / <span>${esc(title)}</span>`;
  const nextLinks = [
    `<a href="/guide/examples/">← All examples</a>`,
    prev ? `<a href="/guide/examples/${esc(prev.slug)}">${esc(prev.title)}</a>` : "",
    next ? `<a href="/guide/examples/${esc(next.slug)}">${esc(next.title)} →</a>` : "",
    `<a href="${esc(gallery)}">Reviewed run</a>`,
  ].filter(Boolean).map((a) => "        " + a).join("\n");

  const inputImgs = s.inputs.filter((i) => i.src).map((i) => {
    const src = "/examples/gallery/" + local(i.src);
    return `<figure><img src="${esc(src)}" alt="${esc(i.label)}" loading="lazy" /><figcaption>${esc(i.label)}</figcaption></figure>`;
  }).join("\n          ");
  const note = s.note
    ? `\n      <div class="callout"><p>${esc(s.note)}</p></div>`
    : "";

  const body = `    <h1><span class="grad">${esc(title)}</span></h1>
    <p class="lede">${esc(how.job)}</p>

    <section>
      <p class="meta-row">${esc(s.review)} · ${esc(s.date)} · Reported saved run: ${esc(cost)}. ${s.models.map((m) => `<code>${esc(m)}</code>`).join(" · ")}</p>
      <p>${esc(how.purpose)}</p>

      <h2>Saved result</h2>
      ${renderMedia(s, how)}
      ${inputImgs ? `<h3>References that went in</h3>\n        <div class="media input-refs${s.inputs.filter((i) => i.src).length > 1 ? " comparison" : ""}">\n          ${inputImgs}\n        </div>` : ""}${note}
      ${s.audioReview?.src ? `<p><a href="/examples/gallery/${esc(local(s.audioReview.src))}">Audio review notes</a></p>` : ""}
      ${renderAlternates(s)}

      <h2>Make it yours</h2>
      <ol class="input-list">
        <li>Open the graph — save first if the canvas already has your work. Undo brings yours back.</li>
        <li>${how.edit}</li>
        <li>Check the editor estimate, then run with your NanoGPT key. ${esc(how.costHow)}</li>
        <li>${how.inspect}</li>
      </ol>

      ${s.workflowNote ? `<p class="howto-note">${esc(s.workflowNote)}</p>` : ""}
      <div class="cta">
        <a class="primary" href="${esc(open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(gallery)}">See the reviewed run</a>
      </div>
      <p class="howto-note"><a href="/examples/gallery/${esc(local(s.workflow))}" download>Download workflow</a>
        · <a href="/examples/gallery/${esc(local(s.slug + "/graph.json"))}" download>Original sampled graph</a>
        · <a href="https://mcp.nanoodle.com/#${esc(s.slug)}">${s.slug === "sing" ? "Hosted MCP (older Sing workflow)" : "Explore MCP tools"}</a>
        · <a href="https://github.com/nanoodlecom/awesome-noodles">awesome-noodles</a></p>`;

  return chrome({
    title: `${title} — nanoodle`,
    description: `${how.job} Reported saved run: ${cost}.`,
    path: `/guide/examples/${s.slug}`,
    crumbs,
    body,
    next: nextLinks,
    share: shareFor(s.slug),
  });
}

function ironPage(prev, next) {
  const crumbs = `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <a href="/guide/examples/">Steal a noodle</a> / <span>${esc(IRON.headline)}</span>`;
  const nextLinks = [
    `<a href="/guide/examples/">← All examples</a>`,
    prev ? `<a href="/guide/examples/${esc(prev.slug)}">${esc(prev.title)}</a>` : "",
    next ? `<a href="/guide/examples/${esc(next.slug)}">${esc(next.title)} →</a>` : "",
    `<a href="${esc(IRON.play)}">Play Iron Verdict</a>`,
  ].filter(Boolean).map((a) => "        " + a).join("\n");
  const body = `    <h1><span class="grad">${esc(IRON.title)}</span></h1>
    <p class="lede">${esc(IRON.job)}</p>

    <section>
      <p class="meta-row">${esc(IRON.review)} · ${esc(IRON.date)} · ${esc(IRON.costLabel)}. Artwork models: ${IRON.models.map((m) => `<code>${esc(m)}</code>`).join(", ")}. Prices and results vary.</p>
      <p>Play the finished game for free. Making your own character uses your NanoGPT key and balance; local rigging needs Node.js and ffmpeg.</p>

      <h2>Saved result</h2>
      <div class="media">
        <figure>
          <a href="${esc(IRON.play)}"><img src="${esc(IRON.preview)}" alt="Iron Verdict — playable foundry fighter" loading="lazy" /></a>
          <figcaption>Playable game · <a href="${esc(IRON.play)}">Open Iron Verdict</a></figcaption>
        </figure>
      </div>

      <p>${esc(IRON.purpose)}</p>

      <h2>Make it yours</h2>
      <ol class="input-list">
        <li>Play it. No key. Motion and sound toggles live on the game page.</li>
        <li>${IRON.edit}</li>
        <li>${esc(IRON.inspect)}</li>
        <li>${esc(IRON.costHow)}</li>
      </ol>

      <div class="cta">
        <a class="primary" href="${esc(IRON.open)}">Open this noodle →</a>
        <a class="secondary" href="${esc(IRON.play)}">Play Iron Verdict</a>
      </div>
      <p class="howto-note"><a href="${esc(IRON.skill)}">Get the character-sprites skill</a>
        · <a href="${esc(IRON.graph)}">Artwork workflow on GitHub</a>
        · <a href="${esc(IRON.zip)}" download>Download game + source</a>
        · <a href="https://mcp.nanoodle.com">Explore MCP tools</a></p>`;

  return chrome({
    title: "Iron Verdict — nanoodle",
    description: `${IRON.job} ${IRON.costLabel}.`,
    path: "/guide/examples/iron-verdict",
    crumbs,
    body,
    next: nextLinks,
  });
}

function hubPage() {
  const cards = (slugs) => slugs.map((slug) => slug === "iron-verdict"
    ? ironCard()
    : cardForSample(sampleBySlug(slug))).join("\n      ");

  const body = `    <h1>Steal a <span class="grad">noodle</span></h1>
    <p class="lede">Continue a story. Give a tiny world its own sound. Turn a room into a mystery.</p>

    <section>
      <p>Each workflow passes what one model made to the next. See the actual results, then open the graph and make it yours. Viewing saved outputs is free.</p>
      <div class="howto-grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))" aria-label="Scenes, sound and stories">
      ${cards(ORDER.slice(0, 3))}
      </div>

      <h2>More things to make</h2>
      <div class="howto-grid" aria-label="More example workflows">
      ${cards(ORDER.slice(3))}
      </div>

      <p>Running your own version uses your NanoGPT key and balance. Your key stays on your device; prompts and media go directly to the model provider when you run. Saved costs describe past runs, and the next result will vary. You can also <a href="/examples/iron-verdict/">play Iron Verdict</a> for free.</p>
      <p>Every guide explains the stages, what to change and what the saved run cost. Use <strong>Open this noodle</strong> to edit the graph. The source graphs live in <a href="https://github.com/nanoodlecom/awesome-noodles" target="_blank" rel="noopener">awesome-noodles</a>. You can also <a href="/guide/run-headless">run the share link headlessly</a>.</p>`;

  const next = [
    `        <a href="/guide/">← Guide</a>`,
    `        <a href="/examples/gallery/">Reviewed gallery</a>`,
    `        <a href="/examples/iron-verdict/">Play Iron Verdict</a>`,
    `        <a href="/guide/run-headless">Run headlessly</a>`,
    `        <a href="/guide/share-links">How share links work</a>`,
  ].join("\n");

  return chrome({
    title: "Steal a noodle — nanoodle",
    description: "Nanoodle workflows with saved results, instructions and reported costs. Open a graph and make it yours.",
    path: "/guide/examples/",
    crumbs: `<a href="/">Home</a> / <a href="/guide/">Guide</a> / <span>Steal a noodle</span>`,
    wide: true,
    body,
    next,
  });
}

function build() {
  const pages = { "index.html": hubPage() };
  const order = ORDER;
  order.forEach((slug, i) => {
    const prevSlug = order[i - 1];
    const nextSlug = order[i + 1];
    const prev = prevSlug ? { slug: prevSlug, title: howTitle(prevSlug) } : null;
    const next = nextSlug ? { slug: nextSlug, title: howTitle(nextSlug) } : null;
    if (slug === "iron-verdict") pages["iron-verdict.html"] = ironPage(prev, next);
    else pages[slug + ".html"] = samplePage(sampleBySlug(slug), prev, next);
  });
  return pages;
}


/** Decode #g= payloads so Node 20 vs 22 gzip byte diffs don't false-stale. */
function normalizeShareLinks(html) {
  return html.replace(
    /#g=([A-Za-z0-9_-]+)/g,
    (_m, b64url) => {
      try {
        const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
        const json = gunzipSync(Buffer.from(padded, "base64")).toString("utf8");
        const digest = createHash("sha256").update(json).digest("hex");
        return `#g=sha256:${digest}`;
      } catch {
        return `#g=${b64url}`;
      }
    },
  );
}

export const PAGE_FILES = () => Object.keys(build());

const pages = build();
mkdirSync(OUT, { recursive: true });
const expected = new Set(Object.keys(pages));
if (process.argv.includes("--check")) {
  const have = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".html")) : [];
  const extra = have.filter((f) => !expected.has(f));
  const missing = [...expected].filter((f) => !have.includes(f));
  const stale = [...expected].filter((f) => {
    const path = join(OUT, f);
    if (!existsSync(path)) return true;
    return normalizeShareLinks(readFileSync(path, "utf8")) !== normalizeShareLinks(pages[f]);
  });
  if (extra.length || missing.length || stale.length) {
    const bits = [];
    if (missing.length) bits.push("missing " + missing.join(", "));
    if (stale.length) bits.push("stale " + stale.join(", "));
    if (extra.length) bits.push("extra " + extra.join(", "));
    throw new Error("Guide example pages out of date (" + bits.join("; ") + "). Run: node scripts/sync-guide-examples.mjs");
  }
  console.log(`✓ guide/examples: ${expected.size} pages match samples.json`);
} else {
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(OUT, name), html);
  for (const name of readdirSync(OUT).filter((f) => f.endsWith(".html"))) {
    if (!expected.has(name)) throw new Error("Unexpected file left in guide/examples/: " + name);
  }
  console.log(`Wrote ${expected.size} how-to pages → guide/examples/`);
}
