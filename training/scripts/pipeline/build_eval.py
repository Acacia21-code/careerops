#!/usr/bin/env python3
"""Build 100 hash-isolated English held-out CareerOps evaluation cases."""
from __future__ import annotations

import json

import pandas as pd

from training.scripts.pipeline.build_match_hard import render_job, render_resume
from training.scripts.pipeline.common import (
    COVER_INSTR, EVAL, JD_PARSE_INSTR, MATCH_INSTR, RAW, ROOT, TAILOR_INSTR,
    read_jsonl, source_pair_hash, write_jsonl,
)


def _case(case_id: str, target: str, prompt: str, constraints: dict, source: dict) -> dict:
    return {
        "id": case_id,
        "target": target,
        "input": prompt,
        "input_hash": source_pair_hash(prompt),
        "expected_constraints": constraints,
        "rubric": {
            "grounding": "No candidate facts may be added beyond the supplied input.",
            "quality": "Judge substantive usefulness, specificity, and clarity.",
            "qualitative_score_fields": ["grounding", "role_alignment", "specificity", "writing_quality"],
        },
        "source": source,
    }


def _training_hashes() -> set[str]:
    hashes = set()
    for directory in (ROOT / "data", ROOT / "data" / "pipeline_staging"):
        if not directory.exists():
            continue
        for path in directory.glob("*.jsonl"):
            if "teacher_queue" in path.name:
                pass
            for row in read_jsonl(path):
                if row.get("messages"):
                    hashes.add(source_pair_hash(row["messages"][0]["content"]))
                elif row.get("prompt"):
                    hashes.add(source_pair_hash(row["prompt"]))
    return hashes


def main() -> None:
    cases = []
    for i in range(25):
        prompt = (
            f"Review this application-board snapshot and recommend the next action. "
            f"Role {i + 1}: {'interview scheduled' if i % 3 == 0 else 'applied'}; "
            f"last activity {i + 2} days ago; fit evidence includes domain experience but one stated gap. "
            "Return a concise priority, rationale, and next step without inventing recruiter activity."
        )
        cases.append(_case(f"board-{i:02d}", "board_ops", prompt, {"must_not_invent_activity": True, "requires_next_action": True}, {"name": "CareerOps heldout scenario", "license": "project-owned"}))

    base = RAW / "michaelozon"
    resumes = pd.read_parquet(base / "resumes_train-00000-of-00001.parquet").set_index("resume_id")
    jobs = pd.read_parquet(base / "jobs_train-00000-of-00001.parquet")
    matches = pd.read_parquet(base / "matches_train-00000-of-00001.parquet").set_index("job_id")
    for i, (_, job) in enumerate(jobs.iloc[:20].iterrows()):
        resume_id = str(matches.loc[job["job_id"], "relevant_resume_ids"]).split("'")[1]
        prompt = f"{MATCH_INSTR}\n\nJOB:\n{render_job(job.to_dict())}\n\nCANDIDATE:\n{render_resume(resumes.loc[resume_id].to_dict())}"
        cases.append(_case(f"match-{i:02d}", "match_grading", prompt, {"json_keys": ["score", "summary", "strengths", "gaps"], "score_range": [0, 100]}, {"name": "michaelozon/candidate-matching-synthetic", "license": "MIT"}))

    masters = read_jsonl(ROOT / "data" / "pipeline_staging" / "master_bank.jsonl")
    for i in range(25):
        master, job = masters[i % len(masters)], jobs.iloc[i % 20]
        prompt = f"{TAILOR_INSTR}\n\nJOB DESCRIPTION:\n{render_job(job.to_dict())}\n\nMASTER RÉSUMÉ:\n{master['text']}"
        cases.append(_case(f"tailor-{i:02d}", "resume_tailoring", prompt, {"word_range": [300, 750], "sections": ["SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION"], "facts_from_master_only": True}, {"name": master["source"], "license": master["license"]}))

    for i in range(10):
        master, job = masters[(i + 25) % len(masters)], jobs.iloc[(i + 5) % 20]
        prompt = f"{COVER_INSTR}\n\nJOB DESCRIPTION:\n{render_job(job.to_dict())}\n\nMASTER RÉSUMÉ:\n{master['text']}"
        cases.append(_case(f"cover-{i:02d}", "cover_letters", prompt, {"word_range": [250, 300], "facts_from_master_only": True, "company_facts_from_jd_only": True}, {"name": master["source"], "license": master["license"]}))

    helix = json.loads((RAW / "helixcipher" / "job_training_data.json").read_text(encoding="utf-8"))
    for i, record in enumerate(helix[:10]):
        prompt = f"{JD_PARSE_INSTR}\n\nJOB POSTING:\n{record['input']}"
        cases.append(_case(f"jd-{i:02d}", "jd_parsing", prompt, {"json_keys": ["company", "title", "seniority", "location", "requirements"], "all_values_substrings": True}, {"name": "HelixCipher/job-training-data", "license": "NOT_DECLARED_ON_HUB_CARD"}))

    for i in range(10):
        prompt = (
            f"Create a two-week English job-search plan for a candidate targeting "
            f"{['product operations', 'data engineering', 'customer success', 'finance', 'partnerships'][i % 5]}. "
            f"They can spend {5 + i} hours weekly and prefer {'remote' if i % 2 else 'hybrid'} work. "
            "Include query strategy, networking actions, and measurable checkpoints."
        )
        cases.append(_case(f"search-{i:02d}", "search_app_knowledge", prompt, {"requires_queries": True, "requires_checkpoints": True, "no_product_ui_invention": True}, {"name": "CareerOps heldout scenario", "license": "project-owned"}))

    if len(cases) != 100:
        raise RuntimeError(f"expected 100 eval cases, got {len(cases)}")
    ids, hashes = [x["id"] for x in cases], [x["input_hash"] for x in cases]
    if len(set(ids)) != 100 or len(set(hashes)) != 100:
        raise RuntimeError("duplicate eval IDs or inputs")
    overlap = set(hashes) & _training_hashes()
    if overlap:
        raise RuntimeError(f"eval leakage detected: {len(overlap)} inputs")
    write_jsonl(EVAL / "careerops_pipeline_eval.jsonl", cases)
    (EVAL / "leakage_report.json").write_text(json.dumps({"eval_cases": 100, "overlap_count": 0, "status": "PASS"}, indent=2) + "\n", encoding="utf-8")
    print({"eval_cases": 100, "leakage_overlap": 0})


if __name__ == "__main__":
    main()
