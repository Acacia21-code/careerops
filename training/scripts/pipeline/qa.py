#!/usr/bin/env python3
"""Run hard schema, language, grounding, and leakage QA over staged outputs."""
from __future__ import annotations

import json
from collections import Counter

from training.scripts.pipeline.common import EVAL, STAGING, is_english, read_jsonl, source_pair_hash


def main() -> None:
    report = {"files": {}, "errors": []}
    train_hashes = set()
    for path in sorted(STAGING.glob("*.jsonl")):
        rows = read_jsonl(path)
        tasks = Counter()
        for index, row in enumerate(rows):
            task = row.get("task")
            if task:
                tasks[task] += 1
            if row.get("messages"):
                prompt, answer = row["messages"][0]["content"], row["messages"][1]["content"]
                train_hashes.add(source_pair_hash(prompt))
                if not is_english(prompt + "\n" + answer):
                    report["errors"].append(f"{path.name}:{index}:non_english")
                if "ONLY JSON" in prompt:
                    try:
                        json.loads(answer)
                    except json.JSONDecodeError:
                        report["errors"].append(f"{path.name}:{index}:invalid_json")
            elif task == "resume_truthfulness_preference":
                if row["chosen"] == row["rejected"] or not row["metadata"].get("injected_facts"):
                    report["errors"].append(f"{path.name}:{index}:invalid_preference")
        report["files"][path.name] = {"rows": len(rows), "tasks": dict(tasks)}
    eval_rows = read_jsonl(EVAL / "careerops_pipeline_eval.jsonl")
    overlaps = [row["id"] for row in eval_rows if row["input_hash"] in train_hashes]
    report["eval"] = {"rows": len(eval_rows), "leakage_overlap": len(overlaps)}
    if overlaps:
        report["errors"].append(f"eval_leakage:{len(overlaps)}")
    report["status"] = "PASS" if not report["errors"] else "FAIL"
    (STAGING / "qa_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "files": len(report["files"]), "errors": len(report["errors"])}))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
