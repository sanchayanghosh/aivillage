#!/usr/bin/env python3
"""Download the AI Village tables the forensics pipeline reads into ./dataset.

Needs HF_TOKEN (env or .env) for an account that has accepted the terms of the
gated dataset aidigestorg/ai-village. events.jsonl.gz is about 330 MB.
"""
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES = ["agents", "agent_goals", "chat_messages", "events"]
BASE = "https://huggingface.co/datasets/aidigestorg/ai-village/resolve/main"


def token() -> str | None:
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"].strip()
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("HF_TOKEN="):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    return None


def main() -> int:
    tok = token()
    if not tok:
        print("HF_TOKEN is not set. Copy .env.example to .env and fill it in.")
        return 1
    out = ROOT / "dataset"
    out.mkdir(exist_ok=True)
    for name in TABLES:
        dest = out / f"{name}.jsonl.gz"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"skip {dest.name} (already present)")
            continue
        req = urllib.request.Request(f"{BASE}/{name}.jsonl.gz", headers={"Authorization": f"Bearer {tok}"})
        try:
            with urllib.request.urlopen(req) as resp, open(dest, "wb") as fh:
                shutil.copyfileobj(resp, fh)
        except urllib.error.HTTPError as err:
            print(f"{name}: HTTP {err.code}. Check that the token has access to the dataset.")
            dest.unlink(missing_ok=True)
            return 1
        print(f"saved {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
