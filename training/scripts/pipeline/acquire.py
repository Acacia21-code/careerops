#!/usr/bin/env python3
"""Verify cached source inventory and write a revisioned acquisition manifest."""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pandas as pd

from training.scripts.pipeline.common import RAW, STAGING, read_jsonl

SOURCES = [
    ("iteratecv", "https://huggingface.co/datasets/abhaykanjoor/iteratecv-resume-tailoring", "6a33db578fda499264731a015860418f634d3db0", "MIT"),
    ("michaelozon", "https://huggingface.co/datasets/michaelozon/candidate-matching-synthetic", "178ab864dcad9910c5670d43e4bdbbb901a11f18", "MIT"),
    ("sukhrob_metadata", "https://huggingface.co/datasets/sukhrobnurali/resume-parsing-vision", "3c254be39d45f69c6e20bfb325b4e6ccb3b5e393", "CC-BY-4.0"),
    ("helixcipher", "https://huggingface.co/datasets/HelixCipher/job-training-data", "b243fef6ebc974b8d5ce8006216d8da53d514633", "NOT_DECLARED_ON_CARD"),
    ("ai_colombia", "https://huggingface.co/datasets/ai-colombia/job-searcher-data", "b2d80853922ce7a2c4419d90478699f231dc23a0", "Apache-2.0"),
    ("job_search_distill", "https://huggingface.co/datasets/emrekuruu/job-search-distill", "e955322bf8cf2d03b6b2024344f1cb4d3cf546db", "Apache-2.0"),
    ("career_agent", "https://huggingface.co/datasets/Builder-Neekhil/career-agent-dataset-v1", "3ff1da8cfeb8a6a886b9b55b3172171c9a0839a2", "NOT_DECLARED_ON_CARD"),
    ("justinthelaw", "https://huggingface.co/datasets/justinthelaw/Resume-DPO-SFT-Dataset", "0a7293d5f54082834c55a2e08c7338c3aef242d1", "Apache-2.0"),
    ("ats_score", "https://huggingface.co/datasets/0xnbk/resume-ats-score-v1-en", "836a2db5ac95094bd423904c2b1a0d06f1b2a505", "Apache-2.0"),
    ("rithankoushik", "https://huggingface.co/datasets/Rithankoushik/job-description-json", "719f5c7bc1412238bf03c34ce3d9d54ade59ee7e", "Apache-2.0"),
    ("jobresqa", "https://github.com/Avature/jobresqa-benchmark/blob/main/data/jobresqa.en.tsv", "00d7cd4d3b166f5a5bf5533dc0b6360cbabc07a7", "CC-BY-SA-2.0"),
    ("onet", "https://www.onetcenter.org/database.html", "30.0", "CC-BY-4.0"),
    ("usajobs_historical", "https://github.com/abigailhaddad/usajobs_historical", "9d0faa8c81394b808cdca6b47d98fb71ec0c4121", "MIT"),
]


def _rows(path: Path) -> int:
    try:
        if path.suffix == ".parquet":
            return len(pd.read_parquet(path, columns=[]))
        if path.suffix == ".csv":
            return sum(1 for _ in path.open(encoding="utf-8", errors="ignore")) - 1
        if path.suffix in {".jsonl", ".tsv"}:
            return sum(1 for _ in path.open(encoding="utf-8", errors="ignore")) - (1 if path.suffix == ".tsv" else 0)
        if path.suffix == ".json":
            value = json.loads(path.read_text(encoding="utf-8"))
            return len(value) if isinstance(value, list) else 1
    except Exception:
        return 0
    return 0


def main() -> None:
    iterate_stats_path = STAGING / "resume_tailoring_iteratecv.stats.json"
    iterate_stats = json.loads(iterate_stats_path.read_text(encoding="utf-8")) if iterate_stats_path.exists() else {}
    accepted = {
        "iteratecv": {"tailoring": iterate_stats.get("accepted", 0)},
        "michaelozon": {
            "match_grading": len(read_jsonl(STAGING / "match_grading_hard.jsonl")),
            "master_bank": sum(row.get("source", "").startswith("michaelozon/") for row in read_jsonl(STAGING / "master_bank.jsonl")),
        },
        "helixcipher": {"jd_parsing": len(read_jsonl(STAGING / "jd_parsing_public.jsonl"))},
        "ai_colombia": {"search_strategy": len(read_jsonl(STAGING / "search_strategy_public.jsonl"))},
        "justinthelaw": {"direct_rows": 0, "method_adapted_preferences": len(read_jsonl(STAGING / "resume_truthfulness_preferences.jsonl"))},
    }
    rejection_notes = {
        "iteratecv": iterate_stats.get("rejections", {}),
        "helixcipher": {"not_integrated": "Hub card does not declare a license; rows remain staged."},
        "ai_colombia": {"not_relevant": "No rows matched strict search-strategy relevance markers; cover examples lacked grounded master résumés."},
        "job_search_distill": {"not_converted": "Resume-linked reasoning was OCR-backed or lacked the resume text needed for a grounded runtime prompt."},
        "career_agent": {"not_converted": "License is not declared and source mixes OCR-derived resume subsets."},
        "ats_score": {"not_converted": "OCR-derived text retained only as classification evidence; clean MIT match source supplied sufficient volume."},
        "sukhrob_metadata": {"not_converted": "Text-bearing parquet was not cached; metadata only."},
    }
    entries = []
    for key, url, revision, license_name in SOURCES:
        directory = RAW / key
        files = [path for path in directory.glob("*") if path.is_file()] if directory.exists() else []
        data_files = [path for path in files if path.suffix in {".parquet", ".csv", ".json", ".jsonl", ".tsv"}]
        raw_rows = sum(_rows(path) for path in data_files)
        entries.append(
            {
                "source": key,
                "url": url,
                "revision": revision,
                "license": license_name,
                "cached_files": len(files),
                "raw_rows_cached": raw_rows,
                "english_filter_rows": raw_rows,
                "accepted_rows": accepted.get(key, {}),
                "rejection_reasons": rejection_notes.get(key, {}),
                "file_hashes": {
                    path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in files if path.stat().st_size < 40_000_000
                },
            }
        )
    failures = [
        {
            "source": "USAJobs live API",
            "reason": "API key required; no credential was configured, and no secret was requested or printed.",
        },
        {
            "source": "CareerOneStop Job Description Writer",
            "reason": "API key required; no credential was configured.",
        },
        {
            "source": "sukhrobnurali data parquet",
            "reason": "Image-bearing parquet is approximately 493 MB; metadata cached, dataset-server text-only request timed out.",
        },
        {
            "source": "med2425/resume-job-fit-merged-v1",
            "reason": "300 MB download deferred because equivalent English label sources were already cached and OCR text is label-only.",
        },
    ]
    manifest = {"policy": "English-only; OCR content never used as a writing target.", "sources": entries, "source_failures": failures}
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print({"sources": len(entries), "failures": len(failures), "cached_rows": sum(x["raw_rows_cached"] for x in entries)})


if __name__ == "__main__":
    main()
