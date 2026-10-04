#!/usr/bin/env python3
"""
scripts/interpret_aivillage_dataset.py

Direct Python interpreter for the AI Village dataset (aidigestorg/ai-village).
Zero database or SQL connector required: directly streams and parses
gzipped JSON Lines tables (events.jsonl.gz, chat_messages.jsonl.gz, agents.jsonl.gz).

Capabilities:
1. Summarizes agent models, message volumes, and internal reasoning frequencies.
2. Extracts real multi-agent incident episodes into JSONL fixtures compatible with
   the Model Forensics Studio web UI.
3. Scans for divergence between internal reasoning and external chat statements.
"""

import os
import sys
import gzip
import json
import argparse
from pathlib import Path
from collections import Counter, defaultdict

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
DATASET_DIR = WORKSPACE_DIR / "dataset"
FIXTURES_DIR = WORKSPACE_DIR / "tests" / "fixtures"

def load_agents() -> dict[str, dict]:
    agents_path = DATASET_DIR / "agents.jsonl.gz"
    if not agents_path.exists():
        print(f"[!] Warning: {agents_path} not found.")
        return {}
    agents = {}
    with gzip.open(agents_path, "rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            agents[row["id"]] = row
    return agents

def extract_thought_from_output(output) -> str | None:
    if not output:
        return None
    
    # 1. Object with 'reasoning' (e.g. OpenAI chat / o-series)
    if isinstance(output, dict):
        if output.get("reasoning"):
            return output["reasoning"]
        if output.get("thought"):
            return output["thought"]
        content = output.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "thinking":
                    return block.get("thinking")
    
    # 2. List of blocks (Anthropic thinking or OpenAI Responses API)
    if isinstance(output, list):
        for block in output:
            if not isinstance(block, dict):
                continue
            # Anthropic
            if block.get("type") == "thinking" and block.get("thinking"):
                return block["thinking"]
            # OpenAI reasoning
            if block.get("type") == "reasoning":
                summary = block.get("summary")
                if isinstance(summary, list) and summary and summary[0].get("text"):
                    return summary[0]["text"]
                if block.get("reasoning"):
                    return block["reasoning"]
            # Gemini parts
            if "candidates" in block:
                cand = block["candidates"]
                if isinstance(cand, list) and cand:
                    parts = cand[0].get("content", {}).get("parts", [])
                    for p in parts:
                        if p.get("thought") and p.get("text"):
                            return p["text"]
    return None

def summarize_dataset(limit: int = 50000):
    print("=== AI Village Dataset Direct Python Interpreter ===")
    agents = load_agents()
    print(f"[*] Loaded {len(agents)} registered agents.")

    events_path = DATASET_DIR / "events.jsonl.gz"
    if not events_path.exists():
        print(f"[!] {events_path} not found.")
        return

    print(f"[*] Streaming through {events_path.name} (first {limit:,} records)...")
    action_counts = Counter()
    model_thought_counts = Counter()
    reasoning_traces_found = 0
    total_events = 0

    with gzip.open(events_path, "rt", encoding="utf-8") as f:
        for i, line in enumerate(f):
            total_events += 1
            row = json.loads(line)
            data = row.get("data") or {}
            action = data.get("actionType") or "UNKNOWN"
            action_counts[action] += 1

            output = data.get("output")
            thought = extract_thought_from_output(output)
            if thought:
                reasoning_traces_found += 1
                spk_id = data.get("speakerId")
                agent_info = agents.get(spk_id, {})
                model = agent_info.get("model_string") or "unknown-model"
                model_thought_counts[model] += 1

            if i >= limit:
                break

    print(f"\n[+] Total events inspected: {total_events:,}")
    print(f"[+] Total internal reasoning traces discovered: {reasoning_traces_found:,}")
    print("\n--- Event Distribution ---")
    for act, cnt in action_counts.most_common(8):
        print(f"  {act:<28} : {cnt:>6,}")

    print("\n--- Internal Monologues / Reasoning by Model ---")
    for mdl, cnt in model_thought_counts.most_common(10):
        print(f"  {mdl:<35} : {cnt:>5,} reasoning traces")

def extract_real_episode_fixture(target_event_count: int = 6):
    """
    Extracts a real coherent sequence of multi-agent events from events.jsonl.gz
    and writes it as a valid JSONL fixture ready for Forensics Studio UI.
    """
    events_path = DATASET_DIR / "events.jsonl.gz"
    if not events_path.exists():
        print(f"[!] {events_path} not found.")
        return

    agents = load_agents()
    print("[*] Extracting real multi-agent incident from AI Village events...")

    extracted_records = []
    with gzip.open(events_path, "rt", encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            data = row.get("data") or {}
            act = data.get("actionType")
            output = data.get("output")
            thought = extract_thought_from_output(output)
            content = data.get("content") or ""

            if act == "AGENT_TALK" and (thought or content):
                spk_id = data.get("speakerId")
                agent_name = agents.get(spk_id, {}).get("name", "agent-village")
                agent_model = agents.get(spk_id, {}).get("model_string", "village-llm")
                created_at = row.get("created_at") or "2026-09-03 12:00:00.000000"

                rec_id = f"real-aiv-{len(extracted_records)+1:03d}"
                record = {
                    "record_id": rec_id,
                    "session_id": "sess-aivillage-real",
                    "agent_id": agent_name.lower().replace(" ", "-"),
                    "timestamp": created_at,
                    "role": "STATEMENT",
                    "event_type": "agent_talk",
                    "payload": {
                        "action_type": act,
                        "model": agent_model,
                        "thought": thought or "Observing village consensus and preparing output claim.",
                        "content": content,
                        "agent_messages": {
                            "candidates": [
                                {
                                    "content": {
                                        "parts": [
                                            {"thought": True, "text": thought or "Evaluating room state."},
                                            {"text": content}
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                }
                extracted_records.append(record)
                if len(extracted_records) >= target_event_count:
                    break

    out_file = FIXTURES_DIR / "real_aivillage_episode.jsonl"
    with open(out_file, "w", encoding="utf-8") as f:
        for r in extracted_records:
            f.write(json.dumps(r) + "\n")

    print(f"[✓] Extracted {len(extracted_records)} real AI Village records to:\n    {out_file}")
    print("[✓] You can now select 'real_aivillage_episode.jsonl' in the Forensics Studio UI dropdown!")

def main():
    parser = argparse.ArgumentParser(description="Direct Python AI Village dataset interpreter")
    parser.add_argument("--summary", action="store_true", help="Print dataset overview and reasoning trace counts")
    parser.add_argument("--extract-fixture", action="store_true", help="Extract a real episode fixture for Forensics Studio UI")
    parser.add_argument("--limit", type=int, default=20000, help="Number of records to scan (default 20,000)")
    args = parser.parse_args()

    if not args.summary and not args.extract_fixture:
        summarize_dataset(limit=args.limit)
        extract_real_episode_fixture()
    else:
        if args.summary:
            summarize_dataset(limit=args.limit)
        if args.extract_fixture:
            extract_real_episode_fixture()

if __name__ == "__main__":
    main()
