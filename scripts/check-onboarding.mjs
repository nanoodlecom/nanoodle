#!/usr/bin/env node
// Pins the first-visit onboarding paths #463 added. smoke-first-run.mjs covers the
// Playwright journey, but it is not in the regular check suite (separate workflow,
// optional Chromium). These contracts must stay true offline, with zero API spend:
//
//   1. Every 📚 "Start with a task" card's data-example-slug resolves to an
//      EXAMPLES entry. A renamed/removed gallery slug makes the card a silent no-op
//      (findIndex === -1 → loadExample never runs) — the first-click dead end #463
//      was written to prevent.
//   2. The real task-card click handler (extracted, not reimplemented) calls
//      loadExample(i) for a matching slug and does nothing for an unknown one.
//   3. Canvas "Sign in with NanoGPT" and the shared-app welcome CTA both click
//      through to the real #signin control. renderAuth hides those signed-out-only
//      pitches once a key is present, so a signed-in visitor is not sent around
//      the OAuth loop again.
//   4. The in-app "Share what you made" links point at the committed
//      share-workflow.yml issue form (not the retired built-with-nanoodle CTA).
//
// House pattern: lift the shipped wiring / renderAuth bodies and drive them in
// node:vm against a tiny DOM stub. No browser, no network.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDX = readFileSync(join(ROOT, "index.html"), "utf8");
const PLAY = readFileSync(join(ROOT, "play.html"), "utf8");

let failed = 0;
const fail = (m) => { console.error("✗ " + m); failed++; };
const ok = (m) => console.log("✓ " + m);

function braceMatch(src, start) {
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced braces from: " + src.slice(start, start + 40));
}

function extractFn(src, needle) {
  const at = src.indexOf(needle);
  if (at === -1) throw new Error("not found: " + needle);
  return braceMatch(src, at);
}

function stubDom() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id,
        hidden: false,
        textContent: "",
        style: {},
        disabled: false,
        clickCount: 0,
        click() { this.clickCount++; },
        onclick: null,
      });
    }
    return els.get(id);
  };
  return { el, $: el, els };
}

// ---- 1. task-card slugs lockstep with EXAMPLES --------------------------------
const examplesAt = IDX.indexOf("const EXAMPLES = [");
if (examplesAt < 0) {
  fail("EXAMPLES array not found");
} else {
  const examplesSrc = IDX.slice(examplesAt, IDX.indexOf("\n];", examplesAt));
  const exampleSlugs = [...examplesSrc.matchAll(/slug:"([^"]+)"/g)].map((m) => m[1]);
  const tasksAt = IDX.indexOf('id="exampletasks"');
  if (tasksAt < 0) fail("#exampletasks is missing — first-click task cards are gone");
  else {
    const tasksSrc = IDX.slice(tasksAt, IDX.indexOf("</div>", tasksAt));
    const taskSlugs = [...tasksSrc.matchAll(/data-example-slug="([^"]+)"/g)].map((m) => m[1]);
    if (taskSlugs.length < 3) fail(`#exampletasks has ${taskSlugs.length} cards — want at least the three first-click tasks`);
    else ok(`#exampletasks has ${taskSlugs.length} first-click task cards`);
    const missing = taskSlugs.filter((s) => !exampleSlugs.includes(s));
    if (missing.length) fail(`task cards point at slugs missing from EXAMPLES (silent no-op): ${missing.join(", ")}`);
    else ok("every task-card slug resolves to an EXAMPLES entry");

    const wireAt = IDX.indexOf('$("exampletasks").querySelectorAll("[data-example-slug]")');
    if (wireAt < 0) fail("task-card click wiring is gone");
    else {
      const wireEnd = IDX.indexOf("});", wireAt);
      const wire = IDX.slice(wireAt, wireEnd + 3);
      if (!/EXAMPLES\.findIndex\(ex=>ex\.slug===button\.dataset\.exampleSlug\)/.test(wire)
        || !/loadExample\(i\)/.test(wire)) {
        fail("task-card handler must resolve slug via EXAMPLES.findIndex and call loadExample(i)");
      } else {
        const loaded = [];
        const buttons = [
          ...taskSlugs.map((slug) => ({ dataset: { exampleSlug: slug }, onclick: null })),
          { dataset: { exampleSlug: "does-not-exist-in-gallery" }, onclick: null },
        ];
        const ctx = {
          EXAMPLES: exampleSlugs.map((slug) => ({ slug })),
          loadExample: (i) => { loaded.push(i); },
          $: (id) => {
            if (id !== "exampletasks") throw new Error("unexpected $(" + id + ")");
            return { querySelectorAll: () => buttons };
          },
        };
        vm.createContext(ctx);
        vm.runInContext(wire, ctx);
        for (const b of buttons) {
          if (typeof b.onclick !== "function") { fail("task-card wiring did not attach onclick"); break; }
          b.onclick();
        }
        const want = taskSlugs.map((slug) => exampleSlugs.indexOf(slug));
        const got = loaded.slice();
        if (JSON.stringify(got) !== JSON.stringify(want))
          fail(`task-card handler loaded ${JSON.stringify(got)} — want ${JSON.stringify(want)} (unknown slug must be a no-op)`);
        else ok("task-card handler loads the matching EXAMPLES index and ignores an unknown slug");
      }
    }
  }
}

// ---- 2. editor canvas sign-in CTA + signed-out-only hint copy -----------------
{
  for (const id of ["hintsignin", "hintauth", "hintsample", "signin"]) {
    if (!new RegExp(`id="${id}"`).test(IDX)) fail(`index.html is missing #${id}`);
  }
  const clickAt = IDX.indexOf('$("hintsignin").onclick');
  if (clickAt < 0) fail("index.html: #hintsignin has no click handler");
  else {
    const line = IDX.slice(clickAt, IDX.indexOf("\n", clickAt));
    if (!/\$\("signin"\)\.click\(\)/.test(line))
      fail("index.html: #hintsignin must click through to #signin (the real OAuth control)");
    else {
      const dom = stubDom();
      const ctx = { $: dom.$ };
      vm.createContext(ctx);
      vm.runInContext(line, ctx);
      dom.$("hintsignin").onclick();
      if (dom.$("signin").clickCount !== 1)
        fail("index.html: #hintsignin click did not reach #signin");
      else ok("editor canvas Sign in clicks through to the real #signin");
    }
  }

  const authSrc = extractFn(IDX, "function renderAuth(){");
  if (!/\$\("hintauth"\)\.hidden = ok/.test(authSrc) || !/\$\("hintsample"\)\.hidden = ok/.test(authSrc))
    fail("index.html renderAuth must hide #hintauth and #hintsample once a key is present");
  else {
    const dom = stubDom();
    const ctx = {
      $: dom.$,
      getKey: () => ctx.key,
      t: (s) => s,
      layoutBar: () => { ctx.laidOut = (ctx.laidOut || 0) + 1; },
      key: null,
    };
    vm.createContext(ctx);
    vm.runInContext(authSrc + "\nrenderAuth;", ctx);
    ctx.renderAuth();
    if (dom.$("hintauth").hidden || dom.$("hintsample").hidden)
      fail("index.html: signed-out renderAuth hid the sign-in / sample pitches");
    ctx.key = "sk-test";
    ctx.renderAuth();
    if (!dom.$("hintauth").hidden || !dom.$("hintsample").hidden)
      fail("index.html: signed-in renderAuth left the sign-in / sample pitches visible");
    else ok("editor renderAuth hides the sign-in and sample pitches once a key is stored");
  }
}

// ---- 3. shared-app welcome Sign in (play.html builder chrome) -----------------
{
  if (!/id="recwelcome-signin"/.test(PLAY)) fail("play.html is missing #recwelcome-signin");
  const clickAt = PLAY.indexOf('$("recwelcome-signin").onclick');
  if (clickAt < 0) fail("play.html: #recwelcome-signin has no click handler");
  else {
    const line = PLAY.slice(clickAt, PLAY.indexOf("\n", clickAt));
    if (!/\$\("signin"\)\.click\(\)/.test(line))
      fail("play.html: #recwelcome-signin must click through to #signin");
    else {
      const dom = stubDom();
      const ctx = { $: dom.$ };
      vm.createContext(ctx);
      vm.runInContext(line, ctx);
      dom.$("recwelcome-signin").onclick();
      if (dom.$("signin").clickCount !== 1)
        fail("play.html: #recwelcome-signin click did not reach #signin");
      else ok("shared-app welcome Sign in clicks through to the real #signin");
    }
  }

  const authSrc = extractFn(PLAY, "function renderAuth(){\n  const signed = !!getKey();");
  if (!/\$\("recwelcome-signin"\)\.hidden = signed/.test(authSrc))
    fail("play.html builder renderAuth must hide #recwelcome-signin once signed in");
  else {
    const dom = stubDom();
    const ctx = {
      $: dom.$,
      getKey: () => ctx.key,
      tB: (s) => s,
      paintBal: () => { ctx.painted = (ctx.painted || 0) + 1; },
      key: null,
    };
    vm.createContext(ctx);
    vm.runInContext(authSrc + "\nrenderAuth;", ctx);
    ctx.renderAuth();
    if (dom.$("recwelcome-signin").hidden)
      fail("play.html: signed-out renderAuth hid the welcome Sign in");
    ctx.key = "sk-test";
    ctx.renderAuth();
    if (!dom.$("recwelcome-signin").hidden)
      fail("play.html: signed-in renderAuth left the welcome Sign in visible");
    else ok("play renderAuth hides the welcome Sign in once a key is stored");
  }
}

// ---- 4. share-workflow issue form (the in-app contribution CTA) ---------------
{
  const form = join(ROOT, ".github/ISSUE_TEMPLATE/share-workflow.yml");
  if (!existsSync(form)) fail("share-workflow.yml is missing — in-app Share links would 404");
  else {
    const yml = readFileSync(form, "utf8");
    if (!/id:\s*share_link/.test(yml)) fail("share-workflow.yml must collect the full share link");
    else if (!/required:\s*true/.test(yml)) fail("share-workflow.yml must require the share-link field");
    else ok("share-workflow.yml still collects a required full share link");
  }
  const href = "template=share-workflow.yml";
  if (!IDX.includes(href)) fail("index.html Examples note must link to share-workflow.yml");
  else ok("editor Examples note points at share-workflow.yml");
  if (!PLAY.includes(href)) fail("play.html Share popover must link to share-workflow.yml");
  else ok("play Share popover points at share-workflow.yml");
  // #463 replaced the built-with-nanoodle CTA on these two surfaces. A revert
  // that puts the retired showcase URL back on the in-app share/examples copy
  // would send people at a list that no longer accepts submissions this way.
  const examplesNote = IDX.slice(IDX.indexOf('id="examplesnote"'), IDX.indexOf("</div>", IDX.indexOf('id="examplesnote"')));
  const showcase = PLAY.slice(PLAY.indexOf('id="sm-showcase"'), PLAY.indexOf("</p>", PLAY.indexOf('id="sm-showcase"')));
  if (/built-with-nanoodle/.test(examplesNote))
    fail("index.html Examples note still points at built-with-nanoodle");
  if (/built-with-nanoodle/.test(showcase))
    fail("play.html Share popover still points at built-with-nanoodle");
  if (!/built-with-nanoodle/.test(examplesNote) && !/built-with-nanoodle/.test(showcase))
    ok("in-app contribution CTAs no longer send people to built-with-nanoodle");
}

if (failed) { console.error("\ncheck-onboarding: " + failed + " failure(s)"); process.exit(1); }
console.log("\ncheck-onboarding: OK");
