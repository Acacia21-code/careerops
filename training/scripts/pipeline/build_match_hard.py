#!/usr/bin/env python3
"""Build balanced hard match examples from clean English synthetic records."""
from __future__ import annotations

import json
import random

import pandas as pd

from training.scripts.pipeline.common import MATCH_INSTR, RAW, STAGING, is_english, make_sft, parse_array, stable_hash, write_jsonl

HOLDOUT_JOB_IDS = 20


def render_resume(row: dict) -> str:
    return "\n".join(
        [
            f"TARGET ROLE: {row['role']}",
            f"SENIORITY: {row['seniority']}",
            f"EXPERIENCE: {row['years_experience']} years in {row['industry']}",
            f"EDUCATION: {row['education']}",
            f"SUMMARY: {row['summary']}",
            "SKILLS: " + ", ".join(parse_array(row["skills"])),
            "EXPERIENCE HIGHLIGHTS:",
            *[f"- {x}" for x in parse_array(row["experience_bullets"])],
        ]
    )


def render_job(row: dict) -> str:
    return "\n".join(
        [
            f"TITLE: {row['job_title']}",
            f"SENIORITY: {row['seniority']}",
            f"INDUSTRY: {row['industry']}",
            row["description"],
            "RESPONSIBILITIES:",
            *[f"- {x}" for x in parse_array(row["responsibilities"])],
            "REQUIREMENTS:",
            *[f"- {x}" for x in parse_array(row["requirements"])],
            "MUST-HAVE SKILLS: " + ", ".join(parse_array(row["must_have_skills"])),
            "NICE-TO-HAVE SKILLS: " + ", ".join(parse_array(row["nice_to_have_skills"])),
        ]
    )


def main() -> None:
    rng = random.Random(20260718)
    base = RAW / "michaelozon"
    resumes = pd.read_parquet(base / "resumes_train-00000-of-00001.parquet").set_index("resume_id")
    jobs = pd.read_parquet(base / "jobs_train-00000-of-00001.parquet")
    matches = pd.read_parquet(base / "matches_train-00000-of-00001.parquet").set_index("job_id")
    rows = []
    all_ids = list(resumes.index)
    for _, job in jobs.iloc[HOLDOUT_JOB_IDS:].iterrows():
        relevant = parse_array(matches.loc[job["job_id"], "relevant_resume_ids"])
        if not relevant:
            continue
        positive_id = relevant[0]
        job_skills = set(parse_array(job["must_have_skills"]))
        negative_candidates = [
            rid for rid in rng.sample(all_ids, min(200, len(all_ids)))
            if rid not in relevant and not (set(parse_array(resumes.loc[rid, "skills"])) & job_skills)
        ]
        if not negative_candidates:
            continue
        for label, resume_id in (("positive", positive_id), ("negative", negative_candidates[0])):
            resume = resumes.loc[resume_id].to_dict()
            jd_text, resume_text = render_job(job.to_dict()), render_resume(resume)
            if not is_english(jd_text + "\n" + resume_text):
                continue
            overlap = sorted(job_skills & set(parse_array(resume["skills"])))
            missing = sorted(job_skills - set(parse_array(resume["skills"])))
            if label == "positive":
                score = min(95, 72 + 5 * len(overlap))
                summary = "Substantive fit: seniority and demonstrated skill coverage align with the role."
            else:
                score = max(8, 35 - 4 * len(missing))
                summary = "Low substantive fit: the candidate lacks the role's core demonstrated skills."
            answer = json.dumps(
                {"score": score, "summary": summary, "strengths": overlap[:4], "gaps": missing[:4]},
                ensure_ascii=False,
            )
            prompt = f"{MATCH_INSTR}\n\nJOB:\n{jd_text}\n\nCANDIDATE:\n{resume_text}"
            rows.append(
                make_sft(
                    "match_grading",
                    prompt,
                    answer,
                    {
                        "source": "michaelozon/candidate-matching-synthetic",
                        "license": "MIT",
                        "label": label,
                        "source_hash": stable_hash({"job": job["job_id"], "resume": resume_id}),
                    },
                )
            )
            if len(rows) >= 2000:
                break
        if len(rows) >= 2000:
            break
    write_jsonl(STAGING / "match_grading_hard.jsonl", rows)
    print({"accepted": len(rows), "positive": sum(x["metadata"]["label"] == "positive" for x in rows)})


if __name__ == "__main__":
    main()
