#!/usr/bin/env node
// flash() must be seen on every screen width (UX review 2026-11-25).
//
// flash() borrows #status (the auth slot) for ~2s. On narrow screens #status is
// moved into the closed ⋯ menu, so 38 call sites ("nothing to run — add a node",
// "can’t change the workflow while running — Stop first", "stopping…", share and
// webcam failures) were silent on phones. And each call armed its own renderAuth
// timer, so a second flash was cut short by the first one's hand-back.
//
// Contract (offline, behavioural on the extracted function):
//  1. Visible #status → text set, no toast.
//  2. Hidden #status (no client rects) → text set AND toast(msg).
//  3. Two flashes 2.0s apart → the second one stays up its full 2.2s.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } else console.log("  ✓ " + m); };

const start = IDX.indexOf("let flashT=null;");
ok(start !== -1, "flash owns a single hand-back timer (let flashT)");
const fnStart = IDX.indexOf("function flash(msg){", start);
let depth = 0, end = -1;
for (let j = IDX.indexOf("{", fnStart); j < IDX.length; j++) {
  if (IDX[j] === "{") depth++; else if (IDX[j] === "}" && --depth === 0) { end = j + 1; break; }
}
const src = IDX.slice(start, end);

function harness(visible) {
  let now = 0; const timers = [];
  const status = { textContent: "signed in", getClientRects: () => (visible ? [1] : []) };
  const ctx = {
    toasts: [], authRenders: 0,
    $: (id) => (id === "status" ? status : null),
    t: (s) => s,
    renderAuth() { ctx.authRenders++; status.textContent = "signed in"; },
    toast(m) { ctx.toasts.push(m); },
    setTimeout(fn, ms) { const h = { fn, at: now + ms, live: true }; timers.push(h); return h; },
    clearTimeout(h) { if (h) h.live = false; },
    advance(ms) { now += ms; for (const h of timers) if (h.live && h.at <= now) { h.live = false; h.fn(); } },
    status,
  };
  vm.createContext(ctx);
  vm.runInContext(src + ";this.flash=flash;", ctx);
  return ctx;
}

const wide = harness(true);
wide.flash("nothing to run — add a node");
ok(wide.status.textContent === "nothing to run — add a node", "visible #status shows the message");
ok(wide.toasts.length === 0, "visible #status does not also toast");

const narrow = harness(false);
narrow.flash("nothing to run — add a node");
ok(narrow.toasts.length === 1 && narrow.toasts[0] === "nothing to run — add a node", "hidden #status (⋯ menu) → message goes to the toast");

const race = harness(true);
race.flash("first");
race.advance(2000);
race.flash("second");
race.advance(300);   // 2.3s after the first flash: its old timer would have reset the slot here
ok(race.status.textContent === "second", "a second flash isn't cut short by the first one's timer");
race.advance(1950);
ok(race.status.textContent === "signed in" && race.authRenders === 1, "the slot hands back to renderAuth once, 2.2s after the last flash");

if (fail) { console.log(`check-flash-visible: ${fail} failed`); process.exit(1); }
console.log("✓ flash() reaches narrow screens via the toast and keeps one hand-back timer");
