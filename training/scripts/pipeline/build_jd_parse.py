#!/usr/bin/env python3
"""Convert English structured postings to substring-grounded CareerOps parses."""
from __future__ import annotations

import json
import re
from collections import Counter

from training.scripts.pipeline.common import JD_PARSE_INSTR, RAW, STAGING, is_english, make_sft, stable_hash, write_jsonl

HOLDOUT_ROWS = 10


def _field(text: str, names: tuple[str, ...]) -> str:
    for name in names:
        match = re.search(rf"(?:\*\*)?{name}(?:\*\*)?\s*:\s*([^\n]+)", text, re.I)
        if match:
            return match.group(1).strip().strip("* ")
    return ""


def _requirements(text: str) -> list[str]:
    candidates = []
    for raw in text.splitlines():
        value = raw.strip().lstrip("•·-* ").strip()
        if raw.strip().startswith(("•", "·", "-", "*")) and 20 <= len(value) <= 240 and value in text:
            candidates.append(value)
    return list(dict.fromkeys(candidates))[:8]


def convert(record: dict) -> tuple[dict | None, str | None]:
    text = str(record.get("input") or "").strip()
    if not is_english(text):
        return None, "non_english"
    if len(re.findall(r"[a-z]{3}[A-Z][a-z]{3}", text)) > 3:
        return None, "ocr_or_concatenation"
    company = _field(text, ("Company", "Organization"))
    title = _field(text, ("Position", "Job Title", "Title", "Role"))
    location = _field(text, ("Location", "Job Location"))
    seniority = next((x for x in ("Executive", "Senior", "Staff", "Principal", "Lead", "Junior", "Entry Level") if x in text), "")
    requirements = _requirements(text)
    if not company or not title or not requirements:
        return None, "missing_grounded_fields"
    parsed = {
        "company": company,
        "title": title,
        "seniority": seniority,
        "location": location,
        "requirements": requirements,
    }
    if any(value and value not in text for key, value in parsed.items() if key != "requirements"):
        return None, "substring_grounding"
    if any(value not in text for value in requirements):
        return None, "substring_grounding"
    prompt = f"{JD_PARSE_INSTR}\n\nJOB POSTING:\n{text}"
    return make_sft(
        "jd_parsing",
        prompt,
        json.dumps(parsed, ensure_ascii=False),
        {
            "source": "HelixCipher/job-training-data",
            "license": "LICENSE_NOT_DECLARED_ON_HUB_CARD",
            "source_hash": stable_hash(record),
        },
    ), None


def main() -> None:
    source = json.loads((RAW / "helixcipher" / "job_training_data.json").read_text(encoding="utf-8"))
    rows, rejects = [], Counter()
    for record in source[HOLDOUT_ROWS:]:
        row, reason = convert(record)
        if row:
            rows.append(row)
        else:
            rejects[reason] += 1
        if len(rows) >= 800:
            break
    write_jsonl(STAGING / "jd_parsing_public.jsonl", rows)
    print({"accepted": len(rows), "rejections": dict(rejects)})


if __name__ == "__main__":
    main()
