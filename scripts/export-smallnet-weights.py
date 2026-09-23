#!/usr/bin/env python3
"""Product · 10 — develop → browser export recipe for vendor/smallnet SNM1.

Standalone Pop!_OS / box path:

  Fixture JSON  →  SNM1 .bin + manifest.json   (for local drop at
  weightsUrl)    OR reverse: existing .bin + manifest → fixture / re-pack.

Never commits .bin. Drop local weights at:
  vendor/next-action/weights/next-action-v1.bin

Examples:
  # Fixture → bin (typical after train-next-action.py wrote smoke-weights.json)
  python scripts/export-smallnet-weights.py \\
    --fixture vendor/next-action/fixtures/smoke-weights.json \\
    --out-bin vendor/next-action/weights/next-action-v1.bin \\
    --out-manifest vendor/next-action/weights/manifest.json

  # Existing SNM1 bin + manifest → re-verify + optional fixture refresh
  python scripts/export-smallnet-weights.py \\
    --bin /path/to/next-action-v1.bin \\
    --manifest /path/to/manifest.json \\
    --out-bin vendor/next-action/weights/next-action-v1.bin \\
    --emit-fixture /tmp/roundtrip-smoke.json

  # Roundtrip self-check (fixture → bin → unpack → compare floats)
  python scripts/export-smallnet-weights.py \\
    --fixture vendor/next-action/fixtures/smoke-weights.json \\
    --out-bin /tmp/na-v1.bin --roundtrip
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

MAGIC = 0x314D4E53  # 'SNM1' LE
FLOAT_TOL = 1e-5


def pack_layers(layers: list[dict]) -> bytes:
    parts = [struct.pack("<II", MAGIC, 1)]
    for L in layers:
        w = L["W"]
        b = L["b"]
        parts.append(struct.pack(f"<{len(w)}f", *w))
        parts.append(struct.pack(f"<{len(b)}f", *b))
    return b"".join(parts)


def unpack_layers(manifest: dict, blob: bytes) -> list[dict]:
    if len(blob) < 8:
        raise ValueError("weights too short")
    magic, ver = struct.unpack_from("<II", blob, 0)
    if magic != MAGIC:
        raise ValueError(f"bad magic {magic:#x}")
    if ver != 1:
        raise ValueError(f"bad weights version {ver}")
    o = 8
    out = []
    for i, L in enumerate(manifest["layers"]):
        n_w = int(L["out"]) * int(L["in"])
        n_b = int(L["out"])
        need = (n_w + n_b) * 4
        if o + need > len(blob):
            raise ValueError(f"truncated weights at layer {i}")
        w = list(struct.unpack_from(f"<{n_w}f", blob, o))
        o += n_w * 4
        b = list(struct.unpack_from(f"<{n_b}f", blob, o))
        o += n_b * 4
        out.append({"W": w, "b": b})
    if o != len(blob):
        raise ValueError("trailing bytes in weights")
    return out


def compare_layers(a: list[dict], b: list[dict], tol: float = FLOAT_TOL) -> None:
    if len(a) != len(b):
        raise AssertionError(f"layer count {len(a)} != {len(b)}")
    for i, (la, lb) in enumerate(zip(a, b)):
        if len(la["W"]) != len(lb["W"]) or len(la["b"]) != len(lb["b"]):
            raise AssertionError(f"layer {i} shape mismatch")
        for j, (x, y) in enumerate(zip(la["W"], lb["W"])):
            if abs(float(x) - float(y)) > tol:
                raise AssertionError(f"layer {i} W[{j}] {x} != {y} (tol={tol})")
        for j, (x, y) in enumerate(zip(la["b"], lb["b"])):
            if abs(float(x) - float(y)) > tol:
                raise AssertionError(f"layer {i} b[{j}] {x} != {y} (tol={tol})")


def load_fixture(path: Path) -> tuple[dict, list[dict]]:
    data = json.loads(path.read_text())
    if "manifest" not in data or "layers" not in data:
        raise ValueError(f"{path}: need {{manifest, layers:[{{W,b}}]}}")
    return data["manifest"], data["layers"]


def load_bin_pair(bin_path: Path, manifest_path: Path) -> tuple[dict, list[dict], bytes]:
    manifest = json.loads(manifest_path.read_text())
    blob = bin_path.read_bytes()
    layers = unpack_layers(manifest, blob)
    return manifest, layers, blob


def write_manifest(path: Path, manifest: dict, weights_url: str | None) -> None:
    out = dict(manifest)
    if weights_url is not None:
        out["weightsUrl"] = weights_url
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Export / roundtrip smallnet SNM1 weights (Product · 10).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--fixture",
        type=Path,
        help="Smoke/fixture JSON {manifest, layers:[{W,b}]}",
    )
    src.add_argument(
        "--bin",
        type=Path,
        help="Existing SNM1 .bin (requires --manifest)",
    )
    ap.add_argument("--manifest", type=Path, help="manifest.json paired with --bin")
    ap.add_argument(
        "--out-bin",
        type=Path,
        help="Write SNM1 .bin here (e.g. vendor/next-action/weights/next-action-v1.bin)",
    )
    ap.add_argument(
        "--out-manifest",
        type=Path,
        help="Write manifest.json (weightsUrl set to relative path of --out-bin when possible)",
    )
    ap.add_argument(
        "--weights-url",
        default=None,
        help="Override weightsUrl in written manifest (default: /vendor/next-action/weights/<out-bin name>)",
    )
    ap.add_argument(
        "--emit-fixture",
        type=Path,
        help="Also write a JSON fixture {manifest, layers} for CI",
    )
    ap.add_argument(
        "--roundtrip",
        action="store_true",
        help="After packing, unpack and compare floats (float32 tolerance)",
    )
    ap.add_argument("--tol", type=float, default=FLOAT_TOL)
    args = ap.parse_args()

    if args.bin and not args.manifest:
        ap.error("--bin requires --manifest")

    if args.fixture:
        manifest, layers = load_fixture(args.fixture)
        blob = pack_layers(layers)
        print(f"packed fixture {args.fixture} → {len(blob)} bytes")
    else:
        manifest, layers, blob = load_bin_pair(args.bin, args.manifest)
        print(f"loaded bin {args.bin} ({len(blob)} bytes) + {args.manifest}")

    if args.roundtrip or args.out_bin:
        # Always validate pack/unpack when writing or when asked
        unpacked = unpack_layers(manifest, blob)
        compare_layers(layers, unpacked, tol=args.tol)
        # Re-pack from unpacked floats to prove symmetry
        blob2 = pack_layers(unpacked)
        if blob2 != blob and not args.bin:
            # float list → pack may differ only if input was already bin; for fixture paths must match
            compare_layers(layers, unpack_layers(manifest, blob2), tol=args.tol)
        print(f"roundtrip OK (tol={args.tol})")

    if args.out_bin:
        args.out_bin.parent.mkdir(parents=True, exist_ok=True)
        args.out_bin.write_bytes(blob)
        print(f"wrote {args.out_bin}")

    if args.out_manifest:
        url = args.weights_url
        if url is None and args.out_bin:
            url = f"/vendor/next-action/weights/{args.out_bin.name}"
        write_manifest(args.out_manifest, manifest, url)
        print(f"wrote {args.out_manifest} weightsUrl={url!r}")

    if args.emit_fixture:
        m = dict(manifest)
        m["weightsUrl"] = None
        payload = {"manifest": m, "layers": layers}
        args.emit_fixture.parent.mkdir(parents=True, exist_ok=True)
        args.emit_fixture.write_text(json.dumps(payload))
        print(f"wrote fixture {args.emit_fixture}")

    if not args.out_bin and not args.out_manifest and not args.emit_fixture and not args.roundtrip:
        print("nothing to write — pass --out-bin / --out-manifest / --emit-fixture / --roundtrip", file=sys.stderr)
        return 2

    mid = manifest.get("id", "?")
    print(
        f"ok id={mid} input={manifest.get('inputSize')} hidden={manifest['layers'][0]['out']} "
        f"out={manifest.get('outputSize')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
