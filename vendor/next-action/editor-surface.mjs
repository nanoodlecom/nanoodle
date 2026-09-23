/**
 * Real Nanoodle editor surface for Product · 1–· 6 + · 14 (port facing helper).
 * Soft tips + action log + Examples→corpus + · 5 local ring + · 6 cold-start seeds.
 * · 14: discrete preferred left/right/up/down facing per node + Apply facing /
 * Scramble facing — no · 7 required. Distinct from · 11 tidy / · 12 nudge / · 13 snap.
 * Dynamic imports so Product · 2 (schema-only) still mounts.
 */
import { ACTION_VOCAB, NODE_TYPES, sketchFromGraph, schema } from "./encode.mjs";
import { createRing, RING_CAPACITY } from "./ring.mjs";
import {
  proposeFacing,
  applyFacingHints,
  scrambleFacing,
  facingSummary,
  FACINGS,
} from "./port-facing.mjs";

const BASE = new URL(".", import.meta.url);

function productMode() {
  try {
    const q = new URLSearchParams(location.search);
    const p = q.get("product") || q.get("na");
    if (p === "1" || p === "2" || p === "3" || p === "4" || p === "5" || p === "6" || p === "14") return Number(p);
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
#na-panel.na-wide{width:268px;max-width:min(268px,calc(100vw - 2rem))}
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
#na-panel .na-ring-meta{display:flex;align-items:center;gap:.45rem;font-size:.7rem;color:var(--dim,#aeb7c8)}
#na-panel .na-ring-meta label{display:flex;align-items:center;gap:.3rem;cursor:pointer;user-select:none}
#na-panel .na-ring-fill{flex:1;height:6px;border-radius:999px;background:#1a1f2c;border:1px solid #2a2e3c;overflow:hidden}
#na-panel .na-ring-fill > i{display:block;height:100%;width:0%;background:linear-gradient(90deg,#22d3ee,#a78bfa);transition:width .2s ease}
#na-panel .na-ring-count{font-variant-numeric:tabular-nums;color:#67e8f9;min-width:3.2rem;text-align:right}
#na-panel .na-ring-slots{display:flex;flex-wrap:wrap;gap:3px;max-height:7.5rem;overflow:auto;padding:.15rem 0}
#na-panel .na-slot{font-size:.58rem;padding:.18rem .32rem;border-radius:5px;background:#12161f;border:1px dashed #2a3348;color:#4b5568;min-width:1.1rem;text-align:center}
#na-panel .na-slot.filled{border-style:solid;border-color:#3d5a70;color:#e0f2fe;background:#152030}
#na-panel .na-slot.newest{border-color:#67e8f9;color:#67e8f9;box-shadow:0 0 0 1px #67e8f933}
#na-panel .na-actions{display:flex;gap:.3rem;flex-wrap:wrap}
#na-panel .na-btn{font:inherit;font-size:.65rem;padding:.28rem .45rem;border-radius:6px;border:1px solid #2a2e3c;background:#1a1f2c;color:#aeb7c8;cursor:pointer}
#na-panel .na-btn:hover{border-color:#67e8f9;color:#67e8f9}
#na-panel .na-note{font-size:.62rem;color:#6b7280;line-height:1.3}
#na-panel .na-trio-row{display:flex;flex-direction:column;gap:.25rem}
#na-panel .na-trio{display:flex;align-items:flex-start;gap:.35rem;width:100%;text-align:left;padding:.35rem .45rem;border-radius:8px;
  border:1px solid #2a3348;background:#121820;color:#aeb7c8;cursor:pointer;font:inherit;font-size:.68rem;line-height:1.3}
#na-panel .na-trio:hover{border-color:#a78bfa;color:#ddd6fe;background:#1a1530}
#na-panel .na-trio .na-trio-count{margin-left:auto;font-size:.6rem;color:#f5d76e;flex-shrink:0}
#na-ghost{position:absolute;pointer-events:none;z-index:5;display:flex;align-items:center;gap:.35rem;padding:.4rem .65rem;
  border:1.5px dashed #3d5a70;border-radius:10px;background:rgba(20,30,45,.55);color:#67e8f9;font:12px/1.2 system-ui;opacity:0;transition:opacity .25s}
#na-ghost.show{opacity:1}
#na-panel .na-face-note{font-size:.68rem;color:#67e8f9;padding:.15rem 0 0;min-height:1em}
#na-panel .na-face-note.flash{color:#a5f3fc}
#na-panel .na-actions{display:flex;gap:.3rem;flex-wrap:wrap}
#na-panel .na-btn{font:inherit;font-size:.65rem;padding:.28rem .45rem;border-radius:6px;border:1px solid #2a2e3c;background:#1a1f2c;color:#aeb7c8;cursor:pointer}
#na-panel .na-btn:hover{border-color:#67e8f9;color:#67e8f9}
.na-face-badge{position:absolute;z-index:6;pointer-events:none;font:700 11px/1 system-ui;color:#67e8f9;
  text-shadow:0 0 6px #0ea5e9aa;opacity:.95;transition:opacity .2s,transform .35s ease}
.na-face-badge[data-facing="right"]{right:4px;top:50%;transform:translateY(-50%)}
.na-face-badge[data-facing="left"]{left:4px;top:50%;transform:translateY(-50%)}
.na-face-badge[data-facing="up"]{left:50%;top:2px;transform:translateX(-50%)}
.na-face-badge[data-facing="down"]{left:50%;bottom:2px;transform:translateX(-50%)}
.na-face-flash{box-shadow:0 0 0 2px #67e8f9aa,0 0 14px #22d3ee55 !important;transition:box-shadow .35s ease,left .4s ease,top .4s ease}
.na-face-side{outline:2px solid #67e8f966;outline-offset:-2px}
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
  if (mode === 5) el.classList.add("na-wide");
  const titles = {
    1: "soft tips · learned",
    2: "action + schema",
    3: "soft tips · frequency",
    4: "gallery → dataset",
    5: "local action ring",
    6: "cold-start seeds",
    14: "port facing helper",
  };
  if (mode === 5) {
    el.innerHTML = `
    <header>
      <span>next-action</span>
      <span class="na-badge">Product · ${mode}</span>
    </header>
    <div class="na-body">
      <div class="na-label" id="na-title">${titles[mode]}</div>
      <div class="na-ring-meta">
        <label><input type="checkbox" id="na-ring-enabled" /> record</label>
        <div class="na-ring-fill" title="ring fill"><i id="na-ring-bar"></i></div>
        <span class="na-ring-count" id="na-ring-count">0/${RING_CAPACITY}</span>
      </div>
      <div class="na-label">ring slots <span style="opacity:.7">(· 2 vocab)</span></div>
      <div class="na-ring-slots" id="na-ring-slots"></div>
      <div class="na-actions">
        <button type="button" class="na-btn" id="na-ring-clear">clear</button>
        <button type="button" class="na-btn" id="na-ring-export">export → clipboard</button>
      </div>
      <div class="na-note" id="na-ring-note">Local only · no network. Flagged ring in memory / localStorage.</div>
      <div class="na-label" id="na-schema-label">schema tokens</div>
      <div class="na-chiprow" id="na-chips"></div>
      <div id="na-tips" hidden></div>
      <div class="na-hist" hidden><b id="na-hist">[ ]</b></div>
      <div class="na-corpus" id="na-corpus" hidden></div>
    </div>`;
  } else {
    el.innerHTML = `
    <header>
      <span>next-action</span>
      <span class="na-badge">Product · ${mode}</span>
    </header>
    <div class="na-body">
      <div class="na-label" id="na-title">${titles[mode] || "tips"}</div>
      <div id="na-tips"></div>
      ${mode === 6 ? `<div class="na-label">first trios</div><div class="na-trio-row" id="na-trios"></div>` : ""}
      ${mode === 14 ? `<div class="na-actions"><button type="button" class="na-btn" id="na-face-apply">Apply facing</button><button type="button" class="na-btn" id="na-face-scramble">Scramble facing</button></div><div class="na-face-note" id="na-face-note">Preferred side · left/right/up/down</div>` : ""}
      <div class="na-label">history</div>
      <div class="na-hist"><b id="na-hist">[ ]</b></div>
      <div class="na-label" id="na-schema-label">schema tokens</div>
      <div class="na-chiprow" id="na-chips"></div>
      <div class="na-corpus" id="na-corpus" hidden></div>
    </div>`;
  }
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

  /** Product · 5 ring (always created; only wired into UI / persist when mode===5 or record path). */
  const ring = createRing({ capacity: RING_CAPACITY });

  chipsEl.innerHTML = ACTION_VOCAB.map(
    (a) => `<span class="na-chip" data-a="${a}">${a}</span>`
  ).join("");

  const freqMod = await tryImport("./frequency.mjs");
  const coldMod = await tryImport("./cold-start.mjs");
  const recMod = await tryImport("./recommend.mjs");
  const snMod = await tryImport("../smallnet/index.js");
  if (freqMod) recommendFrequency = freqMod.recommendFrequency;
  let recommendColdStart = coldMod?.recommendColdStart || null;
  let topFirstTrios = coldMod?.topFirstTrios || null;
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

  function renderRing() {
    if (mode !== 5) return;
    const slotsEl = panel.querySelector("#na-ring-slots");
    const bar = panel.querySelector("#na-ring-bar");
    const countEl = panel.querySelector("#na-ring-count");
    const enabledEl = panel.querySelector("#na-ring-enabled");
    if (!slotsEl) return;
    const tokens = ring.get();
    const cap = ring.capacity;
    if (enabledEl) enabledEl.checked = ring.isEnabled();
    if (countEl) countEl.textContent = `${tokens.length}/${cap}`;
    if (bar) bar.style.width = `${Math.min(100, (100 * tokens.length) / cap)}%`;
    // Show up to 24 newest slots + empty placeholders for visual "filling"
    const show = Math.min(cap, 24);
    const recent = tokens.slice(-show);
    const pad = show - recent.length;
    const parts = [];
    for (let i = 0; i < pad; i++) {
      parts.push(`<span class="na-slot" title="empty">·</span>`);
    }
    recent.forEach((tok, i) => {
      const newest = i === recent.length - 1;
      parts.push(
        `<span class="na-slot filled${newest ? " newest" : ""}" title="${tok}">${tok.replace(/^add:/, "+")}</span>`
      );
    });
    slotsEl.innerHTML = parts.join("");
  }

  function wireRingControls() {
    if (mode !== 5) return;
    const enabledEl = panel.querySelector("#na-ring-enabled");
    const clearBtn = panel.querySelector("#na-ring-clear");
    const exportBtn = panel.querySelector("#na-ring-export");
    const note = panel.querySelector("#na-ring-note");
    // Default ON for · 5 so the usage GIF / first visit shows the ring filling;
    // still flagged — user can turn off; persist respects the flag.
    if (!ring.isEnabled()) ring.setEnabled(true);
    if (enabledEl) {
      enabledEl.checked = ring.isEnabled();
      enabledEl.addEventListener("change", () => {
        ring.setEnabled(enabledEl.checked);
        renderRing();
        if (note) {
          note.textContent = ring.isEnabled()
            ? "Recording · local memory / localStorage · no network."
            : "Paused · ring not writing · local dump still available.";
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        ring.clear();
        renderRing();
        if (note) note.textContent = "Cleared local ring.";
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", async () => {
        const dump = ring.export();
        const text = JSON.stringify(dump, null, 2);
        try {
          await navigator.clipboard.writeText(text);
          if (note) note.textContent = `Exported ${dump.entries.length} tokens → clipboard (local only).`;
        } catch (_) {
          // Fallback: download-less — show in note
          if (note) note.textContent = `Export ready (${dump.entries.length} tokens) — clipboard blocked; see window.__nextAction.ring.export().`;
          try {
            console.log("[next-action] ring export", dump);
          } catch (__) {}
        }
      });
    }
    renderRing();
  }

  function refreshTips() {
    if (mode === 5) {
      renderRing();
      return;
    }
    if (mode === 14) {
      const g = api.getGraph();
      const proposal = proposeFacing(g);
      const applied = applyFacingHints(g);
      if (histEl) histEl.textContent = history.length ? `[ ${history.slice(-5).join(" · ")} ]` : "[ ]";
      if (tipsEl) {
        tipsEl.innerHTML = "";
        const rows = [
          { action: "face:apply", score: applied.cool ? 1 : 3, label: applied.cool ? "Apply facing (cool)" : "Apply facing" },
          { action: "add:text", score: 2, label: "add text" },
          { action: "add:llm", score: 1, label: "add llm" },
        ];
        rows.forEach((r, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "na-tip" + (i === 0 ? " best" : "");
          const pctV = pct(r.score, rows);
          b.innerHTML = `<span>✦ ${r.label}</span><span class="pct">${pctV}%</span>`;
          b.onclick = () => {
            if (r.action === "face:apply") {
              runApplyFacing({ force: true, reason: "tip" });
              refreshTips();
            } else applyTip(r.action);
          };
          tipsEl.appendChild(b);
        });
      }
      paintFacingBadges(proposal.facings);
      const note = panel.querySelector("#na-face-note");
      if (note && !note.classList.contains("flash")) {
        note.textContent = facingSummary(applied);
      }
      return;
    }
    const g = api.getGraph();
    const sketch = sketchFromGraph(g);
    let rows = [];
    const emptyCanvas = !sketch.numNodes;
    if (mode === 6 && tables) {
      if (emptyCanvas && recommendColdStart) {
        rows = recommendColdStart(tables, sketch, 3);
      } else if (recommendFrequency) {
        rows = recommendFrequency(tables, history, sketch, 3);
      }
      renderTrios(emptyCanvas);
    } else if (mode === 1 && session && tables && recommendNext) {
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
    if (histEl) histEl.textContent = history.length ? `[ ${history.slice(-5).join(" · ")} ]` : "[ ]";
    if (tipsEl) {
      tipsEl.innerHTML = "";
      rows.forEach((r, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "na-tip" + (i === 0 ? " best" : "");
        b.innerHTML = `<span>✦ ${actionLabel(r.action)}</span><span class="pct">${pct(r.score, rows)}%</span>`;
        b.onclick = () => applyTip(r.action);
        tipsEl.appendChild(b);
      });
    }
    placeGhost(rows[0]?.action, g);
  }

  let ghostEl = null;
  function placeGhost(action, g) {
    if (mode === 5) return;
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
    const empty = !(g.nodes && g.nodes.length);
    const sel = g.selectedId && g.nodes.find((n) => n.id === g.selectedId);
    let x, y;
    if (empty || (mode === 6 && !sel)) {
      const wr = world?.parentElement?.getBoundingClientRect?.();
      x = Math.max(120, ((wr?.width || 900) / 2) - 40);
      y = Math.max(100, ((wr?.height || 560) / 2) - 20);
    } else {
      x = (sel?.x ?? 280) + 200;
      y = sel?.y ?? 160;
    }
    ghostEl.style.left = x + "px";
    ghostEl.style.top = y + "px";
    ghostEl.classList.add("show");
  }

  
  function renderTrios(emptyCanvas) {
    const triosEl = panel.querySelector("#na-trios");
    if (!triosEl) return;
    if (!emptyCanvas || !tables || !topFirstTrios) {
      triosEl.innerHTML = "";
      return;
    }
    const trios = topFirstTrios(tables, 4);
    triosEl.innerHTML = "";
    trios.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "na-trio";
      const label = (t.actions || []).map(actionLabel).join(" → ");
      b.innerHTML = `<span>✦ ${label}</span><span class="na-trio-count">×${t.count}</span>`;
      b.onclick = () => applyTrio(t.actions || []);
      triosEl.appendChild(b);
    });
  }

  async function applyTrio(actions) {
    const adds = (actions || []).filter((a) => a.startsWith("add:"));
    const baseX = 160;
    const baseY = 180;
    const gap = 220;
    for (let i = 0; i < adds.length; i++) {
      const type = adds[i].slice(4);
      try {
        api.addNode(type, baseX + i * gap, baseY + (i % 2) * 40);
      } catch (e) {
        console.warn("[next-action] trio addNode failed", type, e);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    refreshTips();
  }

function applyTip(action) {
    flashToken(action);
    if (action.startsWith("add:")) {
      const type = action.slice(4);
      const g = api.getGraph();
      const sel = g.selectedId && g.nodes.find((n) => n.id === g.selectedId);
      const empty = !(g.nodes && g.nodes.length);
      let x, y;
      if (empty || (mode === 6 && !sel)) {
        x = 280;
        y = 200;
      } else {
        x = (sel?.x ?? 120) + 220;
        y = sel?.y ?? 160;
      }
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
    // Product · 5: push into flagged ring (no-op when disabled)
    if (mode === 5) ring.record(action);
    flashToken(action);
    refreshTips();
  }

  function setFaceNote(msg) {
    const note = panel.querySelector("#na-face-note");
    if (!note) return;
    note.textContent = msg;
    note.classList.add("flash");
    setTimeout(() => note.classList.remove("flash"), 700);
  }

  function flashFacedNodes(ids) {
    for (const id of ids || []) {
      const el = document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.classList.add("na-face-flash");
      setTimeout(() => el.classList.remove("na-face-flash"), 500);
    }
  }

  const CHEVRON = { left: "◀", right: "▶", up: "▲", down: "▼" };

  function paintFacingBadges(facings) {
    // Clear old badges
    document.querySelectorAll(".na-face-badge").forEach((el) => el.remove());
    for (const f of facings || []) {
      const nodeEl = document.querySelector(`.node[data-id="${CSS.escape(f.id)}"]`);
      if (!nodeEl) continue;
      if (getComputedStyle(nodeEl).position === "static") {
        nodeEl.style.position = "relative";
      }
      const badge = document.createElement("span");
      badge.className = "na-face-badge";
      badge.dataset.facing = f.facing;
      badge.dataset.role = f.role || "";
      badge.title = `${f.role || "node"} · face ${f.facing}`;
      badge.textContent = CHEVRON[f.facing] || "◆";
      nodeEl.appendChild(badge);
    }
  }

  /**
   * Product · 14: apply discrete facing + optional soft nudge via moveNode.
   */
  function runApplyFacing(opts = {}) {
    if (mode !== 14) return;
    const g = api.getGraph();
    const result = applyFacingHints(g, {
      force: !!opts.force,
      ids: opts.ids,
      nudge: opts.nudge !== false,
    });
    paintFacingBadges(result.facings);
    if (api.moveNode && result.positions.length) {
      for (const p of result.positions) {
        try {
          api.moveNode(p.id, p.x, p.y);
        } catch (e) {
          console.warn("[next-action] moveNode failed", p.id, e);
        }
      }
      flashFacedNodes(result.movedIds);
    }
    const reason = opts.reason || "apply";
    setFaceNote(
      result.cool && !opts.force
        ? `already cool · ${result.priorId}`
        : `${reason} · ${result.facings.length} face · ${result.movedIds.length} nudge · ${result.priorId}`
    );
    return result;
  }

  function runScrambleFacing() {
    if (mode !== 14) return;
    const g = api.getGraph();
    let nodes = (g.nodes || []).filter((n) => n.type !== "comment");
    if (nodes.length < 2) {
      try {
        const a = api.addNode("text", 160, 160);
        const b = api.addNode("llm", 380, 200);
        const c = api.addNode("image", 600, 150);
        // Wire a cool chain if connect is available (ports vary by type)
        if (api.connect && a && b && c) {
          try { api.connect(a.id || a, "text", b.id || b, "prompt"); } catch (_) {}
          try { api.connect(b.id || b, "text", c.id || c, "prompt"); } catch (_) {}
        }
      } catch (e) {
        console.warn("[next-action] scramble seed failed", e);
      }
    }
    const g2 = api.getGraph();
    // Messy overlap / reverse LTR so Apply facing has visible nudge work
    if (api.moveNode) {
      const list = (g2.nodes || []).filter((n) => n.type !== "comment");
      const baseX = 240;
      const baseY = 190;
      list.forEach((n, i) => {
        const x = baseX + (list.length - 1 - i) * 36 + (i % 2) * 20;
        const y = baseY + (i % 3) * 22 - 8;
        try {
          api.moveNode(n.id, x, y);
        } catch (_) {}
      });
    }
    const g3 = api.getGraph();
    const result = scrambleFacing(g3);
    paintFacingBadges(result.facings);
    setFaceNote(`scrambled · ${result.facings.length} badges — hit Apply facing`);
    return result;
  }

  function wireFacingControls() {
    if (mode !== 14) return;
    const applyBtn = panel.querySelector("#na-face-apply");
    const scrambleBtn = panel.querySelector("#na-face-scramble");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        runApplyFacing({ force: true, reason: "apply" });
        refreshTips();
      });
    }
    if (scrambleBtn) {
      scrambleBtn.addEventListener("click", () => {
        runScrambleFacing();
        refreshTips();
      });
    }
  }

  wireRingControls();
  wireFacingControls();

  window.__nextAction = {
    record,
    refresh: refreshTips,
    runApplyFacing,
    runScrambleFacing,
    proposeFacing: () => proposeFacing(api.getGraph()),
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
    ring,
  };

  refreshTips();
  return window.__nextAction;
}

export { productMode, ACTION_VOCAB, schema, RING_CAPACITY };
