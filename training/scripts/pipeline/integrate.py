#!/usr/bin/env python3
"""Integrate only QA-passing, licensed staged rows with timestamped backups."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone

from training.scripts.pipeline.common import ROOT, STAGING, read_jsonl, write_jsonl


def main() -> None:
    qa = json.loads((STAGING / "qa_report.json").read_text(encoding="utf-8"))
    if qa.get("status") != "PASS":
        raise RuntimeError("staged QA must pass before integration")
    destination = ROOT / "data" / "match_grading.jsonl"
    staged = read_jsonl(STAGING / "match_grading_hard.jsonl")
    if any(row.get("metadata", {}).get("license") != "MIT" for row in staged):
        raise RuntimeError("only verified MIT match rows may be integrated")
    current = read_jsonl(destination)
    seen = {
        (row["messages"][0]["content"], row["messages"][1]["content"])
        for row in current
    }
    additions = [
        row for row in staged
        if (row["messages"][0]["content"], row["messages"][1]["content"]) not in seen
    ]
    if len(current) + len(additions) > 5000:
        additions = additions[: 5000 - len(current)]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = ROOT / "data" / "backups" / stamp / destination.name
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(destination, backup)
    write_jsonl(destination, [*current, *additions])
    result = {
        "destination": str(destination.relative_to(ROOT)),
        "before": len(current),
        "added": len(additions),
        "after": len(current) + len(additions),
        "backup": str(backup.relative_to(ROOT)),
    }
    (STAGING / "integration_report.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(result)


if __name__ == "__main__":
    main()
