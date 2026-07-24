#!/usr/bin/env python3
"""Build controlled truthfulness preferences without mixing them into SFT."""
from __future__ import annotations

import re

from training.scripts.pipeline.common import ROOT, STAGING, read_jsonl, stable_hash, write_jsonl

SKILL_CANDIDATES = [
    "Kubernetes", "CISSP", "Python", "Java", "Salesforce", "AWS", "Azure",
    "Tableau", "Snowflake", "Terraform", "CPA", "PMP", "Figma", "SAP",
    "Workday", "Docker", "React", "SQL", "Six Sigma", "Google Cloud",
]


def inject_controlled_fact(chosen: str, candidates: list[str]) -> tuple[str, list[str]]:
    fact = next((x for x in candidates if x.lower() not in chosen.lower()), None)
    if not fact:
        raise ValueError("no absent fact available for controlled injection")
    marker = "SKILLS\n"
    if marker in chosen:
        return chosen.replace(marker, f"{marker}{fact}; ", 1), [fact]
    return f"{chosen}\n{fact}.", [fact]


def _jd_candidates(prompt: str, master: str) -> list[str]:
    jd = prompt.split("JOB DESCRIPTION:\n", 1)[-1].split("\n\nMASTER RÉSUMÉ:", 1)[0]
    requested = [skill for skill in SKILL_CANDIDATES if skill.lower() in jd.lower() and skill.lower() not in master.lower()]
    return requested or [skill for skill in SKILL_CANDIDATES if skill.lower() not in master.lower()]


def main() -> None:
    rows = read_jsonl(ROOT / "data" / "resume_tailoring.jsonl")
    output = []
    for source in rows:
        if len(output) >= 500:
            break
        prompt = source["messages"][0]["content"]
        chosen = source["messages"][1]["content"]
        master = prompt.split("MASTER RÉSUMÉ:\n", 1)[-1]
        try:
            rejected, injected = inject_controlled_fact(chosen, _jd_candidates(prompt, master))
        except ValueError:
            continue
        output.append(
            {
                "task": "resume_truthfulness_preference",
                "prompt": prompt,
                "chosen": chosen,
                "rejected": rejected,
                "metadata": {
                    "injected_facts": injected,
                    "source": "CareerOps grounded production tailoring",
                    "source_hash": stable_hash(source),
                    "schema_compatible_with_sft": False,
                },
            }
        )
    if len(output) < 500:
        raise RuntimeError(f"needed 500 preferences, built {len(output)}")
    write_jsonl(STAGING / "resume_truthfulness_preferences.jsonl", output)
    print({"preferences": len(output)})


if __name__ == "__main__":
    main()
