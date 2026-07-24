#!/usr/bin/env python3
"""Build clean master bank and exact-prompt queues when no teacher API exists."""
from __future__ import annotations

import json
import os

import pandas as pd

from training.scripts.pipeline.build_match_hard import render_job, render_resume
from training.scripts.pipeline.common import COVER_INSTR, RAW, ROOT, STAGING, TAILOR_INSTR, stable_hash, write_jsonl


def _fixture_master(master: dict) -> dict:
    return {
        "master_id": master["id"],
        "text": master["text"],
        "source": "CareerOps senior master fixture",
        "license": "project-owned",
    }


def main() -> None:
    fixture_path = ROOT / "scripts" / "fixtures" / "senior_masters.json"
    fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))
    masters = [_fixture_master(master) for master in fixtures]
    resumes = pd.read_parquet(RAW / "michaelozon" / "resumes_train-00000-of-00001.parquet")
    for _, row in resumes.iloc[: max(0, 60 - len(masters))].iterrows():
        masters.append(
            {
                "master_id": row["resume_id"],
                "text": render_resume(row.to_dict()),
                "source": "michaelozon/candidate-matching-synthetic",
                "license": "MIT",
            }
        )
    masters = masters[:60]
    write_jsonl(STAGING / "master_bank.jsonl", masters)

    jobs = pd.read_parquet(RAW / "michaelozon" / "jobs_train-00000-of-00001.parquet").iloc[20:]
    tailoring, covers = [], []
    for master_index, master in enumerate(masters):
        for family_index in range(10):
            job = jobs.iloc[(master_index * 37 + family_index * 101) % len(jobs)]
            jd = render_job(job.to_dict())
            prompt = f"{TAILOR_INSTR}\n\nJOB DESCRIPTION:\n{jd}\n\nMASTER RÉSUMÉ:\n{master['text']}"
            tailoring.append(
                {
                    "queue_id": stable_hash({"master": master["master_id"], "job": job["job_id"], "task": "tailor"}),
                    "task": "resume_tailoring",
                    "prompt": prompt,
                    "fact_allowlist": master["text"],
                    "status": "pending_teacher",
                    "teacher_output": None,
                    "metadata": {"master_source": master["source"], "job_source": "michaelozon/candidate-matching-synthetic", "license": "MIT"},
                }
            )
            if len(covers) < 150 and family_index < 3:
                cover_prompt = f"{COVER_INSTR}\n\nJOB DESCRIPTION:\n{jd}\n\nMASTER RÉSUMÉ:\n{master['text']}"
                covers.append(
                    {
                        "queue_id": stable_hash({"master": master["master_id"], "job": job["job_id"], "task": "cover"}),
                        "task": "cover_letters",
                        "prompt": cover_prompt,
                        "fact_allowlist": master["text"],
                        "status": "pending_teacher",
                        "teacher_output": None,
                        "metadata": {"master_source": master["source"], "job_source": "michaelozon/candidate-matching-synthetic", "license": "MIT"},
                    }
                )
    write_jsonl(STAGING / "resume_tailoring_teacher_queue.jsonl", tailoring)
    write_jsonl(STAGING / "cover_letters_teacher_queue.jsonl", covers)
    write_jsonl(STAGING / "cover_letters_public.jsonl", [])
    available = any(os.getenv(name) for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"))
    print({"teacher_api_available": available, "masters": len(masters), "tailoring_queue": len(tailoring), "cover_queue": len(covers)})


if __name__ == "__main__":
    main()
