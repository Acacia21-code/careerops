#!/usr/bin/env python3
"""Convert IterateCV JSON pairs to exact CareerOps tailoring examples."""
from __future__ import annotations

import json
import re
from collections import Counter
from difflib import SequenceMatcher

import pandas as pd

from training.scripts.pipeline.common import RAW, STAGING, TAILOR_INSTR, is_english, make_sft, stable_hash, words, write_jsonl


def _extract_input(value: str) -> tuple[dict, str]:
    match = re.search(r"MASTER RESUME:\s*(\{.*\})\s*\n\s*JOB DESCRIPTION:\s*(.*)", value, re.S)
    if not match:
        raise ValueError("input schema")
    return json.loads(match.group(1)), match.group(2).strip()


def _all_skills(resume: dict) -> set[str]:
    skills = resume.get("skills", {})
    values = skills.values() if isinstance(skills, dict) else [skills]
    return {str(skill).strip().lower() for group in values for skill in (group if isinstance(group, list) else [group])}


def _render(resume: dict) -> str:
    info = resume.get("personal_info") or {}
    lines = [str(info.get("name") or "Candidate")]
    contact = [info.get(key) for key in ("location", "email", "phone") if info.get(key)]
    if contact:
        lines.append(" | ".join(map(str, contact)))
    lines += ["SUMMARY", str(resume.get("summary") or "").strip(), "EXPERIENCE"]
    for role in resume.get("experience") or []:
        lines.append(f"{role.get('title', '')} — {role.get('company', '')} ({role.get('dates', '')})")
        lines.extend(f"- {bullet}" for bullet in role.get("bullet_points") or [])
    lines.append("SKILLS")
    skills = resume.get("skills") or {}
    if isinstance(skills, dict):
        lines.append(" | ".join(str(x) for group in skills.values() for x in (group if isinstance(group, list) else [group])))
    else:
        lines.append(" | ".join(map(str, skills)))
    lines.append("EDUCATION")
    for education in resume.get("education") or []:
        if isinstance(education, dict):
            lines.append(" | ".join(str(education.get(k, "")) for k in ("degree", "institution", "dates") if education.get(k)))
        else:
            lines.append(str(education))
    return "\n".join(line for line in lines if line.strip()).strip() + "."


def _fact_violations(master: dict, tailored: dict, output: str) -> list[str]:
    violations = []
    master_roles = {
        (str(x.get("title", "")).lower(), str(x.get("company", "")).lower(), str(x.get("dates", "")).lower())
        for x in master.get("experience") or []
    }
    for role in tailored.get("experience") or []:
        identity = (
            str(role.get("title", "")).lower(),
            str(role.get("company", "")).lower(),
            str(role.get("dates", "")).lower(),
        )
        if identity not in master_roles:
            violations.append("role_identity")
    added_skills = _all_skills(tailored) - _all_skills(master)
    if added_skills:
        violations.append("added_skills")
    master_numbers = set(re.findall(r"\b\d+(?:\.\d+)?%?\+?\b", json.dumps(master)))
    output_numbers = set(re.findall(r"\b\d+(?:\.\d+)?%?\+?\b", output))
    if output_numbers - master_numbers:
        violations.append("added_numbers")
    master_education = json.dumps(master.get("education") or [], sort_keys=True).lower()
    for education in tailored.get("education") or []:
        for value in education.values() if isinstance(education, dict) else [education]:
            if value and str(value).lower() not in master_education:
                violations.append("education")
                break
    return sorted(set(violations))


def convert_record(record: dict) -> tuple[dict | None, list[str]]:
    reasons = []
    try:
        master, jd = _extract_input(record["input"])
        tailored = json.loads(record["output"])
    except (KeyError, TypeError, json.JSONDecodeError, ValueError):
        return None, ["schema"]
    master_text, answer = _render(master), _render(tailored)
    if not is_english(master_text + "\n" + jd + "\n" + answer):
        reasons.append("non_english")
    if not 300 <= words(answer) <= 750:
        reasons.append("word_count")
    if SequenceMatcher(None, master_text, answer).ratio() > 0.90:
        reasons.append("over_90pct_identical")
    reasons.extend(_fact_violations(master, tailored, answer))
    if any(token not in answer for token in ("SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION")):
        reasons.append("incomplete")
    if reasons:
        return None, sorted(set(reasons))
    prompt = f"{TAILOR_INSTR}\n\nJOB DESCRIPTION:\n{jd}\n\nMASTER RÉSUMÉ:\n{master_text}"
    return make_sft(
        "resume_tailoring",
        prompt,
        answer,
        {"source": "abhaykanjoor/iteratecv-resume-tailoring", "source_hash": stable_hash(record), "license": "MIT"},
    ), []


def main() -> None:
    accepted, rejects = [], Counter()
    files = sorted((RAW / "iteratecv").glob("*.parquet"))
    for path in files:
        for record in pd.read_parquet(path).to_dict("records"):
            row, reasons = convert_record(record)
            if row:
                accepted.append(row)
            else:
                rejects.update(reasons)
    write_jsonl(STAGING / "resume_tailoring_iteratecv.jsonl", accepted)
    report = {"raw": sum(len(pd.read_parquet(path)) for path in files), "accepted": len(accepted), "rejections": dict(rejects)}
    (STAGING / "resume_tailoring_iteratecv.stats.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
