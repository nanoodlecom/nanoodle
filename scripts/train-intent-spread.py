#!/usr/bin/env python3
"""Product · 52 — train the intent-mode MoG head with ParticleGAN develop.

The head maps a branch-point context (producer type, output port type, intent
modes already used, node-type counts) to a mixture over intent modes. Mode
centers are a ParticleGAN ``MoGParticlePrior`` (one learned particle per
intent mode, fixed MoG noise while training, ``ParticleRegularizer`` on the raw
table so modes stay spread). Each mode scores candidate node types through a
shared type embedding; the editor shows one row per live mode.

Loss: mixture NLL of the next consumer + intent-tag CE on the mode mixture +
in-mode type CE + the ParticleGAN prior regularizer.

  python scripts/train-intent-spread.py \
    --corpus vendor/next-action/corpus/intent-forks.json \
    --out vendor/next-action/intent-spread/weights.json [--holdout-graph SLUG]

Exports ``intent-spread-mog-v1`` JSON (tiny; float32 rounded) read by
vendor/next-action/intent-spread.mjs.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

from particlegan import get_recipe


def featurize(ex, vocab):
    types, ports, modes = vocab["types"], vocab["portTypes"], vocab["modes"]
    x = [0.0] * vocab["inDim"]
    if ex["producerType"] in types:
        x[types.index(ex["producerType"])] = 1.0
    if ex["portType"] in ports:
        x[len(types) + ports.index(ex["portType"])] = 1.0
    off = len(types) + len(ports)
    for m in ex.get("usedModes") or []:
        if m in modes:
            x[off + modes.index(m)] = 1.0
    off2 = off + len(modes)
    for t, c in (ex.get("contextCounts") or {}).items():
        if t in types:
            x[off2 + types.index(t)] = min(3.0, max(0.0, float(c))) / 3.0
    return x


class IntentHead(nn.Module):
    def __init__(self, in_dim, hidden, z_dim, n_modes, n_cand):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hidden)
        self.fc2 = nn.Linear(hidden, z_dim)
        self.mode_bias = nn.Parameter(torch.zeros(n_modes))
        self.type_emb = nn.Parameter(torch.randn(n_cand, z_dim) * 0.3)
        self.type_bias = nn.Parameter(torch.zeros(n_cand))
        self.z_dim = z_dim

    def forward(self, x, means, mode_mask, type_mask):
        h = F.relu(self.fc1(x))
        q = self.fc2(h)
        mode_logits = q @ means.t() / math.sqrt(self.z_dim) + self.mode_bias
        mode_logits = mode_logits.masked_fill(~mode_mask, -1e9)
        log_pi = F.log_softmax(mode_logits, dim=-1)                     # B×K
        type_logits = means @ self.type_emb.t() + self.type_bias        # K×C
        type_logits = type_logits[None].expand(x.shape[0], -1, -1)
        type_logits = type_logits.masked_fill(~type_mask[:, None, :], -1e9)
        log_pk = F.log_softmax(type_logits, dim=-1)                      # B×K×C
        return log_pi, log_pk


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--holdout-graph", default="")
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--hidden", type=int, default=16)
    ap.add_argument("--z-dim", type=int, default=8)
    ap.add_argument("--lr", type=float, default=0.01)
    ap.add_argument("--tag-weight", type=float, default=1.0)
    ap.add_argument("--inmode-weight", type=float, default=0.5)
    ap.add_argument("--prior-reg", type=float, default=0.05)
    ap.add_argument("--ctx-dropout", type=float, default=0.0, help="drop node-type context features per example (generalize to unseen graphs)")
    ap.add_argument("--tag-smooth", type=float, default=0.0, help="label smoothing on the intent-tag CE")
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    corpus = json.loads(args.corpus.read_text())
    vocab = corpus["vocab"]
    types, modes, ports = vocab["types"], vocab["modes"], vocab["portTypes"]
    cbp, mot = vocab["consumersByPort"], vocab["modeOfType"]
    cand = [t for t in types if any(t in cbp[p] for p in ports)]
    examples = [e for e in corpus["examples"] if e["graph"] != args.holdout_graph]
    if args.holdout_graph and len(examples) == len(corpus["examples"]):
        print(f"FAIL: unknown holdout graph {args.holdout_graph}", file=sys.stderr)
        sys.exit(2)

    torch.manual_seed(args.seed)
    if args.threads:
        torch.set_num_threads(args.threads)
    dev = torch.device(args.device)
    X = torch.tensor([featurize(e, vocab) for e in examples], device=dev)
    y_type = torch.tensor([cand.index(e["target"]) for e in examples], device=dev)
    y_mode = torch.tensor([modes.index(e["mode"]) for e in examples], device=dev)
    w = torch.tensor([float(e["weight"]) for e in examples], device=dev)
    port_modes = {p: {mot[t] for t in cbp[p]} for p in ports}
    mode_mask = torch.tensor([[m in port_modes[e["portType"]] for m in modes] for e in examples], device=dev)
    type_mask = torch.tensor([[c in cbp[e["portType"]] for c in cand] for e in examples], device=dev)

    recipe = get_recipe("mog", num_particles=len(modes), z_dim=args.z_dim,
                        total_steps=args.steps, batch_size=len(examples), prior_reg=args.prior_reg)
    prior = recipe.make_prior().to(dev)
    reg = recipe.make_prior_regularizer()
    head = IntentHead(vocab["inDim"], args.hidden, args.z_dim, len(modes), len(cand)).to(dev)
    opt = torch.optim.Adam(list(head.parameters()) + list(prior.parameters()), lr=args.lr, weight_decay=args.weight_decay)
    ctx_start = len(types) + len(ports)          # used modes + context counts live after this column
    idx_all = torch.arange(len(modes), device=dev)

    t0 = time.time()
    for step in range(1, args.steps + 1):
        frac = step / args.steps
        if frac > 0.6:
            for g in opt.param_groups:
                g["lr"] = args.lr * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * (frac - 0.6) / 0.4)))
        means = prior(idx_all)                      # MoG draw: learned centers + fixed sigma noise
        Xin = X
        if args.ctx_dropout > 0:
            keep = (torch.rand(X.shape[0], 1, device=dev) >= args.ctx_dropout).float()
            Xin = X.clone()
            Xin[:, ctx_start + len(modes):] = Xin[:, ctx_start + len(modes):] * keep
        log_pi, log_pk = head(Xin, means, mode_mask, type_mask)
        lp_type = log_pk.gather(2, y_type[:, None, None].expand(-1, len(modes), 1)).squeeze(2)  # B×K
        nll = -torch.logsumexp(log_pi + lp_type, dim=1)
        tag = -log_pi.gather(1, y_mode[:, None]).squeeze(1)
        if args.tag_smooth > 0:
            n_live = mode_mask.float().sum(1)
            tag = (1 - args.tag_smooth) * tag - args.tag_smooth * (log_pi.clamp_min(-30) * mode_mask.float()).sum(1) / n_live
        inmode = -lp_type.gather(1, y_mode[:, None]).squeeze(1)
        loss = ((nll + args.tag_weight * tag + args.inmode_weight * inmode) * w).sum() / w.sum() + reg(prior.z)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        if step == 1 or step % 500 == 0 or step == args.steps:
            with torch.no_grad():
                acc = (log_pi.argmax(1) == y_mode).float().mean().item()
            print(json.dumps({"step": step, "loss": round(loss.item(), 4), "nll": round((nll * w).sum().item() / w.sum().item(), 4),
                              "modeAcc": round(acc, 4)}), flush=True)

    head.eval()
    with torch.no_grad():
        means = prior.means().detach().cpu()
        r = lambda t: [[round(float(v), 5) for v in row] for row in t.tolist()]
        out = {
            "format": "intent-spread-mog-v1",
            "label": "Product · 52",
            "trainer": "scripts/train-intent-spread.py (ParticleGAN develop MoGParticlePrior + ParticleRegularizer)",
            "holdoutGraph": args.holdout_graph or None,
            "inDim": vocab["inDim"], "hidden": args.hidden, "zDim": args.z_dim,
            "modes": modes, "candidates": cand,
            "W1": r(head.fc1.weight.cpu()), "b1": [round(float(v), 5) for v in head.fc1.bias.cpu()],
            "W2": r(head.fc2.weight.cpu()), "b2": [round(float(v), 5) for v in head.fc2.bias.cpu()],
            "means": r(means), "modeBias": [round(float(v), 5) for v in head.mode_bias.cpu()],
            "typeEmb": r(head.type_emb.cpu()), "typeBias": [round(float(v), 5) for v in head.type_bias.cpu()],
            "train": {"steps": args.steps, "examples": len(examples), "seed": args.seed, "device": str(dev),
                      "lr": args.lr, "tagWeight": args.tag_weight, "inmodeWeight": args.inmode_weight,
                      "priorReg": args.prior_reg, "ctxDropout": args.ctx_dropout,
                      "tagSmooth": args.tag_smooth, "weightDecay": args.weight_decay, "mogSigma": round(float(prior.sigma), 6),
                      "finalLoss": round(loss.item(), 5), "seconds": round(time.time() - t0, 2)},
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(json.dumps({"wrote": str(args.out), "bytes": args.out.stat().st_size, **out["train"]}), flush=True)


if __name__ == "__main__":
    main()
