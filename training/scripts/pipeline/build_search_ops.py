#!/usr/bin/env python3
"""Stage only genuine English search-strategy advice; never generic app operation."""
from __future__ import annotations

import json

from training.scripts.pipeline.common import RAW, STAGING, is_english, make_sft, stable_hash, write_jsonl

SEARCH_MARKERS = (
    "job search", "find jobs", "search strategy", "where should i apply", "target companies",
    "career transition", "career change", "job market", "networking", "linkedin search",
)


def main() -> None:
    rows = []
    for line in (RAW / "ai_colombia" / "train_en.jsonl").read_text(encoding="utf-8").splitlines():
        source = json.loads(line)
        messages = source.get("messages") or []
        user = next((x["content"] for x in messages if x.get("role") == "user"), "")
        answer = next((x["content"] for x in messages if x.get("role") == "assistant"), "")
        low = user.lower()
        if not any(marker in low for marker in SEARCH_MARKERS):
            continue
        if not is_english(user + "\n" + answer):
            continue
        rows.append(
            make_sft(
                "search_strategy",
                user,
                answer,
                {"source": "ai-colombia/job-searcher-data:train_en.jsonl", "license": "Apache-2.0", "source_hash": stable_hash(source)},
            )
        )
    write_jsonl(STAGING / "search_strategy_public.jsonl", rows)
    write_jsonl(STAGING / "app_operation_public.jsonl", [])
    write_jsonl(STAGING / "board_ops_public.jsonl", [])
    print({"search_strategy": len(rows), "app_operation": 0, "board_ops": 0})


if __name__ == "__main__":
    main()
