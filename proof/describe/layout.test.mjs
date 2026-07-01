// Offline proof that fromSimple() places NEW described-change nodes by WIRING, so an added
// chain flows left→right instead of dropping into one vertical stack (the old bug). Pure —
// no API, safe for the pre-commit hook. Run: node proof/describe/layout.test.mjs
import { fromSimple } from "./core.mjs";

let fails = 0;
const ok = (cond, msg)=>{ console.log(`  [${cond?"ok ":"NO "}] ${msg}`); if(!cond) fails++; };

// A one-node seed at a known spot; new nodes must land relative to it, never in a blind column.
const PREV = { v:1, nodes:[{ id:"n1", type:"text", x:200, y:0, fields:{ text:"hi" } }], links:[], nid:2, lid:1, view:{} };

// 1) An added CHAIN (n1 → a → b → c) flows horizontally: each new node one column right of its feed.
{
  const simple = {
    nodes:[{id:"n1",type:"text"},{id:"a",type:"llm"},{id:"b",type:"llm"},{id:"c",type:"tts"}],
    links:[
      {from:"n1.text", to:"a.prompt"},
      {from:"a.text",  to:"b.prompt"},
      {from:"b.text",  to:"c.prompt"},
    ],
  };
  const g = fromSimple(simple, PREV);
  const at = id => g.nodes.find(n=>n.id===id);
  ok(at("n1").x===200 && at("n1").y===0, "survivor n1 keeps its exact coords");
  ok(at("a").x > at("n1").x, "a is right of its source n1");
  ok(at("b").x > at("a").x,  "b is right of a");
  ok(at("c").x > at("b").x,  "c is right of b");
  const xs = ["a","b","c"].map(id=>at(id).x);
  ok(new Set(xs).size===3, `chain occupies 3 distinct columns, not one stack (${xs.join(",")})`);
}

// 2) A FAN-OUT (n1 → a, n1 → b) shares a column but staggers vertically so the two don't overlap.
{
  const simple = {
    nodes:[{id:"n1",type:"text"},{id:"a",type:"llm"},{id:"b",type:"llm"}],
    links:[{from:"n1.text",to:"a.prompt"},{from:"n1.text",to:"b.prompt"}],
  };
  const g = fromSimple(simple, PREV);
  const a = g.nodes.find(n=>n.id==="a"), b = g.nodes.find(n=>n.id==="b");
  ok(a.x===b.x, "fan-out siblings share one column");
  ok(Math.abs(a.y-b.y) >= 150, `fan-out siblings don't overlap vertically (Δy=${Math.abs(a.y-b.y)})`);
}

// 3) Source-less new roots still land to the right and stagger (old fallback behaviour preserved).
{
  const simple = { nodes:[{id:"n1",type:"text"},{id:"a",type:"text"},{id:"b",type:"text"}], links:[] };
  const g = fromSimple(simple, PREV);
  const a = g.nodes.find(n=>n.id==="a"), b = g.nodes.find(n=>n.id==="b");
  ok(a.x>200 && b.x>200, "rootless new nodes sit right of the graph");
  ok(a.y!==b.y, "rootless new nodes don't land on top of each other");
}

console.log(fails ? `\nFAIL: ${fails} assertion(s)` : "\nPASS: node layout flows horizontally");
process.exit(fails ? 1 : 0);
