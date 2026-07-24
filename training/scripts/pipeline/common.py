"""Shared helpers for the English-only CareerOps training pipeline."""
from __future__ import annotations

import ast
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable

import os
_DATA = Path(os.environ.get("CAREEROPS_DATA", Path(__file__).resolve().parents[2]))
ROOT = _DATA
RAW = ROOT / "raw" / "pipeline_en"
STAGING = ROOT / "data" / "pipeline_staging"
EVAL = ROOT / "eval"

TAILOR_INSTR = (
    "Tailor this résumé for the job below. Use ONLY real experience from the résumé — "
    "never invent employers, titles, dates, metrics or skills. Re-order, re-word and cut "
    "to fit the role. Keep it ATS-plain and return the complete résumé."
)
COVER_INSTR = (
    "Write a 250-300 word cover letter for this job using ONLY real experience from the "
    "résumé. Open with why this role, prove fit with 2-3 real points, close with a clear ask."
)
MATCH_INSTR = (
    'You are assessing fit like a senior recruiter. Score 0-100, judge substance not vocabulary. '
    'Reply with ONLY JSON: {"score":int,"summary":"...","strengths":[...],"gaps":[...]}'
)
JD_PARSE_INSTR = (
    'Extract key facts from this job posting. Reply with ONLY JSON: '
    '{"company":"...","title":"...","seniority":"...","location":"...","requirements":[...]}'
)

ASCII_WORD = re.compile(r"\b[a-zA-Z][a-zA-Z'-]{1,}\b")
COMMON_EN = set(
    "the and with for from this that role team work experience skills job company candidate "
    "you your to of in a an is are as on will have has our their we manager senior lead "
    "development customer product data business project responsibilities requirements".split()
)
NON_LATIN = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]")
NON_EN_MARKERS = set(
    "og med ansvar kunder erfaren leder nordisk norden søker søker vi och erfarenhet ansvarar "
    "kunden der die und für avec une les para con experiencia".split()
)


def is_english(text: str) -> bool:
    """Conservative English gate without a language-model dependency."""
    if not text or NON_LATIN.search(text):
        return False
    words = [w.lower() for w in ASCII_WORD.findall(text)]
    if len(words) < 5:
        return False
    if sum(word in NON_EN_MARKERS for word in words) >= 2:
        return False
    ascii_ratio = sum(ord(c) < 128 for c in text) / max(1, len(text))
    markers = sum(w in COMMON_EN for w in words)
    return ascii_ratio >= 0.97 and markers >= max(2, len(words) // 80)


def stable_hash(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    return count


def parse_array(value: object) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(x).strip() for x in value if str(x).strip()]
    text = str(value).strip()
    if not text:
        return []
    quoted = [next(part for part in match if part) for match in re.findall(r"'([^']+)'|\"([^\"]+)\"", text)]
    if len(quoted) > 1:
        return quoted
    try:
        parsed = ast.literal_eval(text.replace("\n", ","))
        if isinstance(parsed, (list, tuple)):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except (ValueError, SyntaxError):
        pass
    return quoted


def make_sft(task: str, prompt: str, answer: str, metadata: dict | None = None) -> dict:
    row = {
        "task": task,
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": answer},
        ],
    }
    if metadata:
        row["metadata"] = metadata
    return row


def words(text: str) -> int:
    return len(re.findall(r"\b[\w'+-]+\b", text))


def source_pair_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()
