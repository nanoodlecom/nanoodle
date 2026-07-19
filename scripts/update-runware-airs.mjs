#!/usr/bin/env node
// Rebuild runware-airs.json (and stamp the inlined RUNWARE-AIRS block in index.html).
//
// Sources:
//   1. Runware public content catalog (content.runware.ai/models) — live t2i platform AIRs
//   2. NanoGPT image catalog — any runware:/persona: rows they surface
//   3. SEED — verified civitai:/persona: AIRs (and a few platform fallbacks)
//
//   node scripts/update-runware-airs.mjs
//   node scripts/update-runware-airs.mjs --probe   # optional live check (needs NANOGPT_API_KEY)
//
// The editor also fetches content.runware.ai at runtime (CORS *) and merges into the
// Runware group. This stamp is the offline fallback + the CivitAI/Persona seeds.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = join(root, "runware-airs.json");
const INDEX = join(root, "index.html");
const RUNWARE_CONTENT_URL = "https://content.runware.ai/models";
const NANOGPT_CATALOG_URL = "https://nano-gpt.com/api/v1/image-models";
const GEN_URL = "https://nano-gpt.com/v1/images/generations";
const probe = process.argv.includes("--probe");
const key = process.env.NANOGPT_API_KEY || "";

// Verified on custom-civitai (NanoGPT). Names are human labels; air is what the API gets.
// Re-probe with --probe after adding entries.
const SEED = [
  // Platform fallbacks (also pulled from content.runware.ai when reachable)
  { air: "runware:100@1", name: "FLUX.1 [schnell]", group: "runware" },
  { air: "runware:101@1", name: "FLUX.1 [dev]", group: "runware" },
  { air: "runware:400@1", name: "FLUX.2 [dev]", group: "runware" },
  { air: "runware:106@1", name: "FLUX.1 Kontext [dev]", group: "runware" }, // img2img/edit-leaning; kept as known custom-civitai AIR
  { air: "runware:107@1", name: "FLUX.1 Krea [dev]", group: "runware" },

  // Persona — only known-good AIR on custom-civitai so far
  { air: "persona:376130@2456367", name: "Nova Anime XL", group: "persona" },

  // CivitAI — popular checkpoints live-verified OK (2026-07)
  { air: "civitai:133005@1759168", name: "Juggernaut XL (Ragnarok)", group: "civitai" },
  { air: "civitai:133005@782002", name: "Juggernaut XL", group: "civitai" },
  { air: "civitai:305149@392545", name: "Promissing Realistic XL", group: "civitai" },
  { air: "civitai:112902@126688", name: "DreamShaper XL", group: "civitai" },
  { air: "civitai:112902@354657", name: "DreamShaper XL Lightning", group: "civitai" },
  { air: "civitai:4384@128713", name: "DreamShaper 8", group: "civitai" },
  { air: "civitai:139562@789646", name: "RealVisXL V5.0", group: "civitai" },
  { air: "civitai:139562@798204", name: "RealVisXL V5.0 Lightning", group: "civitai" },
  { air: "civitai:4201@130072", name: "Realistic Vision V5.1", group: "civitai" },
  { air: "civitai:25694@143906", name: "epiCRealism", group: "civitai" },
  { air: "civitai:43331@176425", name: "majicMIX realistic", group: "civitai" },
  { air: "civitai:7371@425083", name: "ReV Animated", group: "civitai" },
  { air: "civitai:25494@177164", name: "Beautiful Realistic Asians", group: "civitai" },
  { air: "civitai:4468@57618", name: "Counterfeit-V3.0", group: "civitai" },
  { air: "civitai:9409@384264", name: "Anything XL", group: "civitai" },
  { air: "civitai:119229@916744", name: "ZavyChromaXL", group: "civitai" },
  { air: "civitai:43977@570138", name: "LEOSAM HelloWorld XL", group: "civitai" },
  { air: "civitai:140737@1041855", name: "AlbedoBase XL", group: "civitai" },
  { air: "civitai:84040@395107", name: "YamerMIX (SDXL Unstable)", group: "civitai" },
  { air: "civitai:122606@297740", name: "DynaVision XL", group: "civitai" },
  { air: "civitai:119012@592322", name: "blue_pencil-XL", group: "civitai" },
  { air: "civitai:288584@324619", name: "AutismMix SDXL", group: "civitai" },
  { air: "civitai:372465@914390", name: "Pony Realism", group: "civitai" },
  { air: "civitai:101055@128078", name: "Stable Diffusion XL 1.0", group: "civitai" },
];

const GROUP_META = {
  runware: { id: "runware", label: "Runware", order: 0 },
  civitai: { id: "civitai", label: "CivitAI", order: 1 },
  persona: { id: "persona", label: "Persona", order: 2 },
};

function groupOf(air) {
  if (air.startsWith("runware:")) return "runware";
  if (air.startsWith("civitai:")) return "civitai";
  if (air.startsWith("persona:")) return "persona";
  return null;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
  return r.json();
}

async function fetchRunwareContent() {
  const items = await fetchJson(RUNWARE_CONTENT_URL);
  if (!Array.isArray(items)) throw new Error("content.runware.ai: expected array");
  const out = [];
  for (const m of items) {
    if (m.status && m.status !== "live") continue;
    const air = String(m.air || "");
    if (!air.startsWith("runware:")) continue;
    const caps = m.capabilities || [];
    // text-to-image only — custom-civitai is an image-gen path
    if (!Array.isArray(caps) || !caps.includes("io:text-to-image")) continue;
    out.push({
      air,
      name: m.name || air,
      group: "runware",
      source: "runware-content",
      creator: m.creator || "",
      headline: m.headline || "",
      architecture: m.architecture || "",
    });
  }
  return out;
}

async function fetchNanogptCatalog() {
  const j = await fetchJson(NANOGPT_CATALOG_URL);
  const items = j.data || j || [];
  const out = [];
  for (const m of items) {
    const air = String(m.id || "");
    const g = groupOf(air);
    if (!g) continue;
    out.push({
      air,
      name: m.name || air,
      group: g,
      source: "nanogpt-catalog",
    });
  }
  return out;
}

async function probeAir(air) {
  if (!key) throw new Error("--probe requires NANOGPT_API_KEY");
  const body = {
    model: "custom-civitai",
    prompt: "a simple red apple on a table",
    size: "512x512",
    n: 1,
    response_format: "b64_json",
    customCivitaiAir: air,
  };
  const r = await fetch(GEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "x-api-key": key,
    },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true };
  let msg = "";
  try {
    const j = await r.json();
    msg = j?.error?.code || j?.error?.message || "";
  } catch {
    msg = await r.text();
  }
  return { ok: false, status: r.status, msg: String(msg).slice(0, 120) };
}

function stampIndex(payload) {
  const src = readFileSync(INDEX, "utf8");
  const begin = "/* === RUNWARE-AIRS-BEGIN === */";
  const end = "/* === RUNWARE-AIRS-END === */";
  const bi = src.indexOf(begin);
  const ei = src.indexOf(end);
  if (bi < 0 || ei < 0 || ei < bi) {
    throw new Error("RUNWARE-AIRS markers not found in index.html — add the block first");
  }
  const block =
    begin +
    "\n// Generated by scripts/update-runware-airs.mjs — do not hand-edit.\n" +
    "const RUNWARE_AIRS = " +
    JSON.stringify(payload, null, 2) +
    ";\n" +
    end;
  const next = src.slice(0, bi) + block + src.slice(ei + end.length);
  writeFileSync(INDEX, next);
}

// runware-content wins for platform rows; seed wins over nanogpt shorthand for our curated labels
const SOURCE_RANK = { "runware-content": 3, seed: 2, "nanogpt-catalog": 1 };

function upsert(byAir, entry) {
  const prev = byAir.get(entry.air);
  if (!prev) {
    byAir.set(entry.air, entry);
    return;
  }
  const prefNew = (SOURCE_RANK[entry.source] || 0) >= (SOURCE_RANK[prev.source] || 0);
  byAir.set(entry.air, {
    air: entry.air,
    group: prev.group || entry.group,
    // Prefer Runware content names (official), then longer / existing
    name: prefNew
      ? entry.name || prev.name
      : prev.name || entry.name,
    creator: entry.creator || prev.creator || "",
    headline: entry.headline || prev.headline || "",
    architecture: entry.architecture || prev.architecture || "",
    source: prefNew ? entry.source : prev.source,
  });
}

async function main() {
  const byAir = new Map();

  try {
    const content = await fetchRunwareContent();
    for (const m of content) upsert(byAir, m);
    console.log(`runware content: ${content.length} live text-to-image model(s)`);
  } catch (e) {
    console.warn("content.runware.ai fetch failed — keeping seed runware rows:", e.message);
  }

  try {
    const items = await fetchNanogptCatalog();
    for (const m of items) upsert(byAir, m);
    console.log(`nanogpt catalog: ${items.length} runware:/persona:/civitai: model(s)`);
  } catch (e) {
    console.warn("nanogpt catalog fetch failed:", e.message);
  }

  // Seed last so verified civitai/persona rows land, and curated names win over NanoGPT shorthand
  for (const s of SEED) {
    upsert(byAir, {
      air: s.air,
      name: s.name,
      group: s.group,
      source: "seed",
      creator: "",
      headline: "",
    });
  }

  let models = [...byAir.values()].sort((a, b) =>
    a.group === b.group
      ? a.name.localeCompare(b.name)
      : (GROUP_META[a.group]?.order ?? 9) - (GROUP_META[b.group]?.order ?? 9)
  );

  if (probe) {
    console.log(`probing ${models.length} AIR(s) via custom-civitai…`);
    const kept = [];
    for (const m of models) {
      process.stdout.write(`  ${m.air} … `);
      try {
        const r = await probeAir(m.air);
        if (r.ok) {
          console.log("OK");
          kept.push(m);
        } else {
          console.log(`FAIL ${r.status || ""} ${r.msg || ""}`.trim());
        }
      } catch (e) {
        console.log("ERR", e.message);
      }
    }
    models = kept;
  }

  const groupsMap = new Map();
  for (const m of models) {
    const meta = GROUP_META[m.group] || { id: m.group, label: m.group, order: 50 };
    if (!groupsMap.has(meta.id)) {
      groupsMap.set(meta.id, { id: meta.id, label: meta.label, order: meta.order, models: [] });
    }
    const row = { air: m.air, name: m.name, source: m.source };
    if (m.creator) row.creator = m.creator;
    if (m.headline) row.headline = m.headline;
    if (m.architecture) row.architecture = m.architecture;   // gates the negative-prompt field (FLUX-family ignores it)
    groupsMap.get(meta.id).models.push(row);
  }
  const groups = [...groupsMap.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ id, label, models: ms }) => ({ id, label, models: ms }));

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    groups,
  };

  writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2) + "\n");
  stampIndex(payload);
  const n = groups.reduce((s, g) => s + g.models.length, 0);
  console.log(`wrote ${JSON_OUT} (${n} models in ${groups.length} group(s))`);
  for (const g of groups) console.log(`  ${g.id}: ${g.models.length}`);
  console.log(`stamped RUNWARE_AIRS in index.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
