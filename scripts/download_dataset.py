#!/usr/bin/env python3
"""
download_dataset.py: Downloads and inspects aidigestorg/ai-village dataset from Hugging Face.
Reads HF_TOKEN from:
1. .env file in the workspace
2. ~/.cache/huggingface/token
3. HF_TOKEN environment variable
"""

import os
import sys
import gzip
import json
import urllib.request
import urllib.error
from pathlib import Path

DATASET_REPO = "aidigestorg/ai-village"
HF_API_BASE = f"https://huggingface.co/api/datasets/{DATASET_REPO}"
HF_RAW_BASE = f"https://huggingface.co/datasets/{DATASET_REPO}/raw/main"
HF_RESOLVE_BASE = f"https://huggingface.co/datasets/{DATASET_REPO}/resolve/main"

def load_hf_token() -> str | None:
    # 1. Check environment variable
    token = os.environ.get("HF_TOKEN")
    if token and token != "your_huggingface_token_here":
        return token.strip()

    # 2. Check local .env file
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("HF_TOKEN=") and not line.startswith("#"):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val and val != "your_huggingface_token_here":
                        return val

    # 3. Check ~/.cache/huggingface/token
    cache_token_path = Path.home() / ".cache" / "huggingface" / "token"
    if cache_token_path.exists():
        with open(cache_token_path, "r", encoding="utf-8") as f:
            val = f.read().strip()
            if val:
                return val

    return None

def fetch_url(url: str, token: str | None) -> bytes:
    headers = {"User-Agent": "SwarmEvidenceGraph/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return resp.read()

def main():
    print(f"=== AI Village Dataset Downloader [{DATASET_REPO}] ===")
    token = load_hf_token()

    if not token:
        print("\n[!] HF_TOKEN not found or contains placeholder.")
        print("Please edit the .env file in the repository root:")
        print(f"  File: {Path(__file__).resolve().parent.parent / '.env'}")
        print("Set your Hugging Face access token:")
        print("  HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
        print("\nAlso ensure you have accepted the dataset access terms at:")
        print(f"  https://huggingface.co/datasets/{DATASET_REPO}")
        sys.exit(1)

    print(f"[*] HF_TOKEN detected ({token[:4]}...{token[-4:]})")
    out_dir = Path(__file__).resolve().parent.parent / "dataset"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fetch metadata & files list
    print(f"[*] Querying dataset metadata from Hugging Face API...")
    try:
        meta_bytes = fetch_url(HF_API_BASE, token)
        meta = json.loads(meta_bytes.decode("utf-8"))
        print(f"[*] Repository: {meta.get('id')} | Gated: {meta.get('gated')}")
        siblings = [s.get("rfilename") for s in meta.get("siblings", [])]
        print(f"[*] Available files ({len(siblings)} total):")
        for s in siblings[:15]:
            print(f"    - {s}")
        if len(siblings) > 15:
            print(f"    ... and {len(siblings) - 15} more")
    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            print(f"\n[ERROR] Authentication failed (HTTP {e.code}).")
            print("Your token may be invalid, or you haven't accepted the dataset license on:")
            print(f"  https://huggingface.co/datasets/{DATASET_REPO}")
            sys.exit(1)
        raise

    # 2. Download documentation & schema files
    for doc_name in ["SCHEMA.md", "README.md"]:
        print(f"[*] Fetching {doc_name}...")
        try:
            content = fetch_url(f"{HF_RAW_BASE}/{doc_name}", token).decode("utf-8")
            doc_path = out_dir / doc_name
            doc_path.write_text(content, encoding="utf-8")
            print(f"    -> Saved to {doc_path} ({len(content)} bytes)")
        except Exception as e:
            print(f"    [!] Warning fetching {doc_name}: {e}")

    # 3. Print inspection summary
    schema_path = out_dir / "SCHEMA.md"
    if schema_path.exists():
        print("\n=== Dataset Schema Summary ===")
        lines = schema_path.read_text(encoding="utf-8").splitlines()
        for line in lines[:30]:
            print(line)
        print("...\n[Full schema saved in dataset/SCHEMA.md]")

if __name__ == "__main__":
    main()
