/**
 * Real Nanoodle editor surface for Product · 1–· 4 next-action.
 * Soft tips + action log + optional Examples→corpus chip.
 * Dynamic imports so Product · 2 (schema-only) still mounts.
 */
import { ACTION_VOCAB, NODE_TYPES, sketchFromGraph, schema } from "./encode.mjs";

const BASE = new URL(".", import.meta.url);

function productMode() {
  try {
    const q = new URLSearchParams(location.search);
    const p = q.get("product") || q.get("na");
    if (p === "1" || p === "2" || p === "3" || p === "4") return Number(p);
  } catch (_) {}
  return 1;
}

function pct(score, rows) {
  const sum = rows.reduce((a, r) => a + (Number(r.score) || 0), 0) || 1;
  return Math.round((100 * (Number(score) || 0)) / sum);
}

function actionLabel(a) {
  if (a.startsWith("add:")) return `add ${a.slice(4)}`;
  if (a === "open:examples") return "open Examples";
  if (a === "set:model") return "set model";
  return a;
}

async function loadJSON(rel) {
  const res = await fetch(new URL(rel, BASE));
  if (!res.ok) throw new Error(`fetch ${rel} ${res.status}`);
  return res.json();
}

async function tryImport(rel) {
  try {
    return await import(rel);
  } catch (_) {
    return null;
  }
}

async function loadSession(packWeights, createSession) {
  if (!packWeights || !createSession) return null;
  try {
    const fix = await loadJSON("fixtures/smoke-weights.json");
    const layers = fix.layers.map((L) => ({
      W: Float32Array.from(L.W),
      b: Float32Array.from(L.b),
    }));
    const manifest = fix.manifest;
    const buf = packWeights(manifest, layers);
    return createSession(manifest, buf);
  } catch (e) {
    console.warn("[next-action] learned session unavailable", e);
    return null;
  }
}

function ensureStyles() {
  if (document.getElementById("na-surface-css")) return;
  const s = document.createElement("style");
  s.id = "na-surface-css";
  s.textContent = `
#na-panel{position:fixed;right:1rem;bottom:calc(var(--db-h,3rem) + 3.6rem);z-index:130;width:240px;max-width:min(240px,calc(100vw - 2rem));
  background:rgba(18,21,29,.94);border:1px solid var(--line,#2a2e3c);border-radius:12px;box-shadow:0 8px 28px #0008;
  color:var(--ink,#eef1f7);font:12px/1.35 system-ui,-apple-system,sans-serif;backdrop-filter:blur(8px);overflow:hidden}
#na-panel header{display:flex;align-items:center;gap:.4rem;padding:.45rem .65rem;border-bottom:1px solid var(--line,#2a2e3c);font-weight:600;font-size:.78rem}
#na-panel .na-badge{margin-left:auto;font-size:.62rem;font-weight:500;padding:.12rem .4rem;border-radius:999px;background:#1a2840;color:#67e8f9;border:1px solid #2a4060}
#na-panel .na-body{padding:.45rem .55rem .55rem;display:flex;flex-direction:column;gap:.35rem}
#na-panel .na-label{font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;color:var(--dim,#aeb7c8)}
#na-panel .na-tip{display:flex;align-items:center;gap:.4rem;width:100%;text-align:left;padding:.4rem .5rem;border-radius:8px;
  border:1px dashed #3a4560;background:#141a28;color:var(--dim,#aeb7c8);cursor:pointer;font:inherit}
#na-panel .na-tip:hover,#na-panel .na-tip.best{border-style:solid;border-color:#67e8f9;color:#67e8f9;background:#152030}
#na-panel .na-tip .pct{margin-left:auto;font-size:.65rem;color:#f5d76e}
#na-panel .na-hist{font-size:.68rem;color:var(--dim,#aeb7c8);word-break:break-word}
#na-panel .na-hist b{color:#6ee7b7;font-weight:600}
#na-panel .na-chiprow{display:flex;flex-wrap:wrap;gap:.25rem;max-height:4.2rem;overflow:auto}
#na-panel .na-chip{font-size:.62rem;padding:.15rem .35rem;border-radius:6px;background:#1a1f2c;border:1px solid #2a2e3c;color:#aeb7c8}
#na-panel .na-chip.on{border-color:#7c8cff;color:#c5cbff}
#na-panel .na-corpus{font-size:.7rem;color:#67e8f9;padding:.25rem 0 0}
#na-ghost{position:absolute;pointer-events:none;z-index:5;display:flex;align-items:center;gap:.35rem;padding:.4rem .65rem;
  border:1.5px dashed #3d5a70;border-radius:10px;background:rgba(20,30,45,.55);color:#67e8f9;font:12px/1.2 system-ui;opacity:0;transition:opacity .25s}
#na-ghost.show{opacity:1}
`;
  document.head.appendChild(s);
}

function buildPanel(mode) {
  ensureStyles();
  let el = document.getElementById("na-panel");
  if (el) return el;
  el = document.createElement("aside");
  el.id = "na-panel";
  el.setAttribute("aria-label", "Next-action tips");
  const titles = {
    1: "soft tips · learned",
    2: "action + schema",
    3: "soft tips · frequency",
    4: "gallery → dataset",
  };
  el.innerHTML = `
    <header>
      <span>next-action</span>
      <span class="na-badge">Product · ${mode}</span>
    </header>
    <div class="na-body">
      <div class="na-label" id="na-title">${titles[mode] || "tips"}</div>
      <div id="na-tips"></div>
      <div class="na-label">history</div>
      <div class="na-hist"><b id="na-hist">[ ]</b></div>
      <div class="na-label" id="na-schema-label">schema tokens</div>
      <div class="na-chiprow" id="na-chips"></div>
      <div class="na-corpus" id="na-corpus" hidden></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

/**
 * @param {{
 *   getGraph: () => {nodes:any[], links:any[], selectedId?:string|null},
 *   addNode: (type:string, x?:number, y?:number) => any,
 *   openExamples: () => void,
 *   runSelected?: () => void,
 *   worldEl?: HTMLElement | null,
 * }} api
 */
export async function mount(api) {
  const mode = productMode();
  const panel = buildPanel(mode);
  const tipsEl = panel.querySelector("#na-tips");
  const histEl = panel.querySelector("#na-hist");
  const chipsEl = panel.querySelector("#na-chips");
  const corpusEl = panel.querySelector("#na-corpus");

  /** @type {string[]} */
  let history = [];
  let tables = null;
  let session = null;
  let corpusMeta = null;
  let recommendFrequency = null;
  let recommendNext = null;

  chipsEl.innerHTML = ACTION_VOCAB.map(
    (a) => `<span class="na-chip" data-a="${a}">${a}</span>`
  ).join("");

  const freqMod = await tryImport("./frequency.mjs");
  const recMod = await tryImport("./recommend.mjs");
  const snMod = await tryImport("../smallnet/index.js");
  if (freqMod) recommendFrequency = freqMod.recommendFrequency;
  if (recMod) recommendNext = recMod.recommendNext;

  try {
    tables = await loadJSON("corpus/frequency-tables.json");
  } catch (_) {
    tables = null;
  }
  if (mode === 1 && snMod) {
    session = await loadSession(snMod.packWeights, snMod.createSession);
  }
  try {
    const c = await loadJSON("corpus/gallery-synth.json");
    corpusMeta = {
      examples: c.exampleCount,
      graphs: (c.graphs && c.graphs.length) || c.graphCount || 10,
    };
  } catch (_) {
    corpusMeta = null;
  }

  function flashToken(tok) {
    const chip = chipsEl?.querySelector(`[data-a="${CSS.escape(tok)}"]`);
    if (!chip) return;
    chip.classList.add("on");
    setTimeout(() => chip.classList.remove("on"), 900);
  }

  function refreshTips() {
    const g = api.getGraph();
    const sketch = sketchFromGraph(g);
    let rows = [];
    if (mode === 1 && session && tables && recommendNext) {
      rows = recommendNext({ tables, session, blend: 0.35 }, history, sketch, 3);
    } else if ((mode === 1 || mode === 3) && tables && recommendFrequency) {
      rows = recommendFrequency(tables, history, sketch, 3);
    } else if (mode === 2) {
      rows = (history.length === 0
        ? ["add:text", "add:image", "open:examples"]
        : ["add:llm", "wire", "add:image"]
      ).map((action, i) => ({ action, score: 3 - i, source: "schema" }));
    } else if (mode === 4) {
      rows = [
        { action: "open:examples", score: 3, source: "gallery" },
        { action: "add:text", score: 2, source: "gallery" },
        { action: "add:image", score: 1, source: "gallery" },
      ];
    } else if (tables && recommendFrequency) {
      rows = recommendFrequency(tables, history, sketch, 3);
    } else {
      rows = ["add:text", "add:image", "open:examples"].map((action, i) => ({
        action,
        score: 3 - i,
        source: "schema",
      }));
    }
    if ((mode === 4 || mode === 1) && corpusMeta) {
      corpusEl.hidden = false;
      corpusEl.textContent = `bake corpus · ${corpusMeta.examples} examples / ${corpusMeta.graphs} gallery graphs`;
    }
    histEl.textContent = history.length ? `[ ${history.slice(-5).join(" · ")} ]` : "[ ]";
    tipsEl.innerHTML = "";
    rows.forEach((r, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "na-tip" + (i === 0 ? " best" : "");
      b.innerHTML = `<span>✦ ${actionLabel(r.action)}</span><span class="pct">${pct(r.score, rows)}%</span>`;
      b.onclick = () => applyTip(r.action);
      tipsEl.appendChild(b);
    });
    placeGhost(rows[0]?.action, g);
  }

  let ghostEl = null;
  function placeGhost(action, g) {
    const world = api.worldEl || document.getElementById("world");
    if (!world || !action || !action.startsWith("add:")) {
      if (ghostEl) ghostEl.classList.remove("show");
      return;
    }
    if (!ghostEl) {
      ghostEl = document.createElement("div");
      ghostEl.id = "na-ghost";
      world.appendChild(ghostEl);
    }
    const type = action.slice(4);
    ghostEl.textContent = `ghost · ${type}`;
    const sel = g.selectedId && g.nodes.find((n) => n.id === g.selectedId);
    const x = (sel?.x ?? 280) + 200;
    const y = sel?.y ?? 160;
    ghostEl.style.left = x + "px";
    ghostEl.style.top = y + "px";
    ghostEl.classList.add("show");
  }

  function applyTip(action) {
    flashToken(action);
    if (action.startsWith("add:")) {
      const type = action.slice(4);
      const g = api.getGraph();
      const sel = g.selectedId && g.nodes.find((n) => n.id === g.selectedId);
      const x = (sel?.x ?? 120) + 220;
      const y = sel?.y ?? 160;
      try {
        api.addNode(type, x, y);
      } catch (e) {
        console.warn("[next-action] addNode failed", type, e);
      }
      return;
    }
    if (action === "open:examples") {
      api.openExamples();
      return;
    }
    if (action === "run" && api.runSelected) {
      api.runSelected();
      record(action);
      return;
    }
    record(action);
  }

  function record(action) {
    if (!ACTION_VOCAB.includes(action)) return;
    history = history.concat(action).slice(-schema.K * 3);
    flashToken(action);
    refreshTips();
  }

  window.__nextAction = {
    record,
    refresh: refreshTips,
    onExamplesOpened() {
      if ((mode === 4 || mode === 1) && corpusMeta) {
        corpusEl.hidden = false;
        corpusEl.textContent = `bake corpus · ${corpusMeta.examples} examples / ${corpusMeta.graphs} gallery graphs (from Examples)`;
      }
      record("open:examples");
    },
    onExampleLoaded() {
      refreshTips();
    },
    mode,
    schemaVersion: schema.schemaVersion,
  };

  refreshTips();
  return window.__nextAction;
}

export { productMode, ACTION_VOCAB, schema };
