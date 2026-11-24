#!/usr/bin/env python3
"""Publish the Atlas integration outcome as a CI annotation and job summary.

GitHub's log archive is not always downloadable from automation, so the result of
the Atlas integration job is also surfaced through the check-run annotations API
(where `::notice::` lines land) and the run summary. Only counts, statuses and
the recorded skip reason are emitted — never a connection string or a secret.

Usage: report_atlas_outcome.py <jest-log-file> [<preflight-json>]
"""

from __future__ import annotations

import json
import os
import re
import sys

SUMMARY_RE = re.compile(r"^(Test Suites|Tests):\s*(.+)$", re.MULTILINE)
SKIP_TITLE_RE = re.compile(r"^\s*(?:○\s*)?(MongoDB Atlas integration\s*—?\s*SKIPPED:.*)$", re.MULTILINE)
FAIL_RE = re.compile(r"^(FAIL|PASS)\s+(.+)$", re.MULTILINE)


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    try:
        return report(sys.argv)
    except Exception as error:  # never let the reporter mask the suite result
        detail = f"{type(error).__name__}: {error}"
        print(f"::error title=Atlas report::{detail}")
        return 0


def report(argv: list[str]) -> int:
    log = read(argv[1])
    preflight_path = argv[2] if len(argv) > 2 else "tests/atlas/preflight.json"
    preflight: dict = {}
    try:
        preflight = json.loads(read(preflight_path) or "{}")
    except json.JSONDecodeError:
        preflight = {}

    available = bool(preflight.get("available"))
    reason = str(preflight.get("reason", "")).strip()
    # Strip anything that could embed a credential from a driver error message.
    reason = re.sub(r"mongodb(\+srv)?://\S+", "<connection string redacted>", reason)
    reason = reason[:400] or "no reason recorded"

    summaries = {key: value.strip() for key, value in SUMMARY_RE.findall(log)}
    suites = summaries.get("Test Suites", "not captured")
    tests = summaries.get("Tests", "not captured")
    skip_title = SKIP_TITLE_RE.search(log)
    skip_reason = skip_title.group(1).strip() if skip_title else ""
    suite_lines = [f"{match.group(1)} {match.group(2).strip()}" for match in FAIL_RE.finditer(log)]

    if available:
        headline = f"Atlas integration ran LIVE against {preflight.get('testDatabase') or 'the configured test database'}"
        status = "live"
    else:
        headline = f"Atlas integration SKIPPED — {reason}"
        status = "skipped"

    passed = int(re.search(r"(\d+)\s+passed", tests).group(1)) if re.search(r"(\d+)\s+passed", tests) else 0
    skipped = int(re.search(r"(\d+)\s+skipped", tests).group(1)) if re.search(r"(\d+)\s+skipped", tests) else 0
    failed = int(re.search(r"(\d+)\s+failed", tests).group(1)) if re.search(r"(\d+)\s+failed", tests) else 0

    message = (
        f"{headline} | suites: {suites} | tests: {tests}"
        f" | uri scheme: {preflight.get('uriScheme', 'unknown')}"
        f" | transactions: {'yes' if preflight.get('transactions') else 'no'}"
        f" | latency: {preflight.get('latencyMs', 0)} ms"
    )
    print(f"::notice title=Atlas integration::{message}")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n### Atlas integration outcome\n\n")
            handle.write(f"- Result: **{'ran against a live Atlas database' if available else 'skipped (reported honestly, not passed)'}**\n")
            handle.write(f"- Pre-flight: `{reason}`\n")
            handle.write(f"- Test database: `{preflight.get('testDatabase') or 'n/a'}`\n")
            handle.write(f"- URI scheme: `{preflight.get('uriScheme', 'unknown')}`\n")
            handle.write(f"- Transactions (replica set): {'yes' if preflight.get('transactions') else 'no'}\n")
            handle.write(f"- Probe latency: {preflight.get('latencyMs', 0)} ms\n")
            handle.write(f"- Suites: {suites}\n")
            handle.write(f"- Tests: {tests} ({passed} passed, {skipped} skipped, {failed} failed)\n")
            if skip_reason:
                handle.write(f"- Suite title: `{skip_reason}`\n")
            if suite_lines:
                handle.write(f"- Jest suites: {', '.join(suite_lines[:6])}\n")
            handle.write("\nNo connection string, credential or secret value is printed here.\n")

    # A live run that reports zero tests would be a silent failure; call it out.
    if available and passed == 0 and failed == 0:
        print("::warning title=Atlas integration::a live database was reachable but no test reported as passed")
    if failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
