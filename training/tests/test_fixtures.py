"""Synthetic fixture smoke tests — no personal data."""
from __future__ import annotations

import json
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "sample_synth.jsonl"
BANNED = ("du" + "san", "mili" + "cevic")


def test_sample_synth_loads():
    rows = [json.loads(line) for line in FIX.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(rows) >= 2
    for row in rows:
        assert "id" in row and "messages" in row
        assert all(m.get("role") in {"user", "assistant", "system"} for m in row["messages"])


def test_sample_names_are_synthetic():
    text = FIX.read_text(encoding="utf-8").lower()
    for needle in BANNED:
        assert needle not in text
    assert "jordan lee" in text
