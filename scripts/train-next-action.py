#!/usr/bin/env python3
"""Product · 1 — train tiny next-action MLP with ParticleGAN develop.

Fits a smallnet-mlp-v1 classifier on gallery synth using MoGParticlePrior +
ParticleRegularizer from get_recipe(). Exports:
  - SNM1 .bin under particlegan-product1-runs/ (gitignored)
  - JSON float fixture under vendor/next-action/fixtures/ for check-next-action.mjs
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

from particlegan import get_recipe

MAGIC = 0x314D4E53  # 'SNM1' LE


def encode_state(history, sketch, schema):
    vocab = schema["actionVocab"]
    types = schema["nodeTypes"]
    k = schema["K"]
    cap = schema.get("encode", {}).get("countNormCap", 8)
    v, t = len(vocab), len(types)
    out = [0.0] * (k * v + t + 5 + t)
    o = 0
    hist = list(history or [])[-k:]
    pad = k - len(hist)
    for s in range(k):
        tok = None if s < pad else hist[s - pad]
        if tok is not None and tok in vocab:
            out[o + vocab.index(tok)] = 1.0
        o += v
    counts = (sketch or {}).get("nodeTypeCounts") or {}
    for i, name in enumerate(types):
        out[o + i] = min(float(counts.get(name, 0)), cap) / cap
    o += t
    n_nodes = int((sketch or {}).get("numNodes") or 0)
    n_links = int((sketch or {}).get("numLinks") or 0)
    out[o] = min(n_nodes, cap) / cap
    out[o + 1] = min(n_links, cap) / cap
    out[o + 2] = 1.0 if (sketch or {}).get("danglingOut") else 0.0
    out[o + 3] = 1.0 if (sketch or {}).get("danglingIn") else 0.0
    out[o + 4] = 1.0 if n_nodes == 0 else 0.0
    o += 5
    sel = (sketch or {}).get("selectedType")
    if sel in types:
        out[o + types.index(sel)] = 1.0
    return out


class TinyNextAction(nn.Module):
    def __init__(self, in_dim, hidden, out_dim):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hidden)
        self.fc2 = nn.Linear(hidden, out_dim)

    def forward(self, x, return_hidden=False):
        h = F.relu(self.fc1(x))
        logits = self.fc2(h)
        return (logits, h) if return_hidden else logits


def pack_snm1(model: TinyNextAction) -> bytes:
    parts = [struct.pack("<II", MAGIC, 1)]
    with torch.no_grad():
        for layer in (model.fc1, model.fc2):
            w = layer.weight.detach().cpu().float().reshape(-1).tolist()
            b = layer.bias.detach().cpu().float().reshape(-1).tolist()
            parts.append(struct.pack(f"<{len(w)}f", *w))
            parts.append(struct.pack(f"<{len(b)}f", *b))
    return b"".join(parts)


def layer_params_json(model: TinyNextAction):
    out = []
    with torch.no_grad():
        for layer in (model.fc1, model.fc2):
            out.append(
                {
                    "W": layer.weight.detach().cpu().float().reshape(-1).tolist(),
                    "b": layer.bias.detach().cpu().float().reshape(-1).tolist(),
                }
            )
    return out


def split_examples(examples, seed=0, holdout=0.2):
    g = torch.Generator().manual_seed(seed)
    idx = torch.randperm(len(examples), generator=g).tolist()
    n_hold = max(1, int(len(examples) * holdout))
    hold = [examples[i] for i in idx[:n_hold]]
    train = [examples[i] for i in idx[n_hold:]]
    return train, hold


def batchify(examples, schema, device):
    vocab = schema["actionVocab"]
    xs, ys = [], []
    for ex in examples:
        xs.append(encode_state(ex.get("history"), ex.get("sketch"), schema))
        ys.append(vocab.index(ex["nextAction"]))
    return (
        torch.tensor(xs, dtype=torch.float32, device=device),
        torch.tensor(ys, dtype=torch.long, device=device),
    )


@torch.no_grad()
def eval_top(model, examples, schema, device, k=3):
    if not examples:
        return {"n": 0, "top1": 0.0, "top3": 0.0}
    model.eval()
    x, y = batchify(examples, schema, device)
    logits = model(x)
    pred1 = logits.argmax(dim=1)
    topk = logits.topk(min(k, logits.size(1)), dim=1).indices
    top1 = (pred1 == y).float().mean().item()
    top3 = (topk == y[:, None]).any(dim=1).float().mean().item()
    return {"n": len(examples), "top1": top1, "top3": top3}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--schema", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fixture", type=Path, help="Write smoke-weights.json here")
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    schema = json.loads(args.schema.read_text())
    corpus = json.loads(args.corpus.read_text())
    examples = [
        e
        for e in corpus["examples"]
        if e.get("nextAction") in schema["actionVocab"]
    ]
    if len(examples) < 20:
        print("FAIL: too few examples", file=sys.stderr)
        sys.exit(2)

    train_ex, hold_ex = split_examples(examples, seed=args.seed, holdout=0.2)
    device = torch.device(args.device)
    torch.manual_seed(args.seed)

    in_dim = schema["K"] * len(schema["actionVocab"]) + len(schema["nodeTypes"]) + 5 + len(schema["nodeTypes"])
    hidden = int(schema["smallnet"]["hidden"])
    out_dim = len(schema["actionVocab"])
    model = TinyNextAction(in_dim, hidden, out_dim).to(device)

    recipe = get_recipe(
        prior_kind="mog",
        num_particles=64,
        z_dim=hidden,
        total_steps=args.steps,
        batch_size=args.batch,
        prior_reg=0.05,
    )
    prior = recipe.make_prior().to(device)
    reg = recipe.make_prior_regularizer()

    opt = torch.optim.Adam(
        list(model.parameters()) + list(prior.parameters()),
        lr=recipe.lr,
        betas=recipe.betas,
    )

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "export").mkdir(exist_ok=True)
    (args.out / "metrics").mkdir(exist_ok=True)

    n = len(train_ex)
    history = []
    model.train()
    for step in range(1, args.steps + 1):
        t = step / args.steps
        if t >= recipe.lr_anneal_start:
            frac = (t - recipe.lr_anneal_start) / max(1e-8, 1 - recipe.lr_anneal_start)
            scale = recipe.lr_floor + (1 - recipe.lr_floor) * (1 - frac)
            for pg in opt.param_groups:
                pg["lr"] = recipe.lr * scale

        idx = torch.randint(0, n, (min(args.batch, n),))
        batch = [train_ex[i] for i in idx.tolist()]
        x, y = batchify(batch, schema, device)
        logits, h = model(x, return_hidden=True)
        ce = F.cross_entropy(logits, y)
        # ParticleGAN prior regularizer on particle table + light hidden diversity
        preg = reg(prior.z)
        hide_reg = reg(h)
        loss = ce + preg + 0.25 * hide_reg
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()

        if step == 1 or step % 250 == 0 or step == args.steps:
            metrics = {
                "step": step,
                "loss": float(loss.detach()),
                "ce": float(ce.detach()),
                "preg": float(preg.detach()),
                "train": eval_top(model, train_ex[:512], schema, device),
                "holdout": eval_top(model, hold_ex, schema, device),
            }
            history.append(metrics)
            print(json.dumps(metrics), flush=True)
            model.train()

    final = {
        "train": eval_top(model, train_ex, schema, device),
        "holdout": eval_top(model, hold_ex, schema, device),
        "steps": args.steps,
        "recipe": recipe.to_dict(),
        "in_dim": in_dim,
        "hidden": hidden,
        "out_dim": out_dim,
        "example_count": len(examples),
        "train_count": len(train_ex),
        "holdout_count": len(hold_ex),
    }
    final["pass"] = (
        final["holdout"]["top3"] >= 0.55
        and final["holdout"]["top1"] >= 0.35
        and final["train"]["top1"] >= 0.45
    )
    (args.out / "metrics" / "train-metrics.json").write_text(
        json.dumps({"final": final, "history": history}, indent=2)
    )
    print(json.dumps({"final": final}), flush=True)

    blob = pack_snm1(model)
    bin_path = args.out / "export" / "next-action-v1.bin"
    bin_path.write_bytes(blob)

    manifest = {
        "id": schema["smallnet"]["id"],
        "version": str(schema["schemaVersion"]),
        "format": schema["smallnet"]["format"],
        "inputSize": in_dim,
        "outputSize": out_dim,
        "layers": [
            {"type": "linear", "in": in_dim, "out": hidden, "activation": "relu"},
            {
                "type": "linear",
                "in": hidden,
                "out": out_dim,
                "activation": schema["smallnet"]["outputActivation"],
            },
        ],
        "weightsUrl": None,
    }
    (args.out / "export" / "manifest.json").write_text(json.dumps(manifest, indent=2))

    smoke = {"manifest": manifest, "layers": layer_params_json(model), "metrics": final}
    smoke_path = args.out / "export" / "smoke-weights.json"
    smoke_path.write_text(json.dumps(smoke))

    fixture = args.fixture or (args.schema.parent / "fixtures" / "smoke-weights.json")
    fixture.parent.mkdir(parents=True, exist_ok=True)
    fixture.write_text(json.dumps(smoke))
    print(f"wrote {bin_path} ({len(blob)} bytes) and {fixture}", flush=True)
    sys.exit(0 if final["pass"] else 1)


if __name__ == "__main__":
    main()
