#!/usr/bin/env python3
"""Emit a readable `flutter test` result annotation from a CI log.

Flutter's reporter writes progress with carriage returns and ANSI colour codes,
which makes a shell `grep` for the summary line unreliable. This parser strips
control sequences, splits on both `\\r` and `\\n`, and reports:

  * the highest `+N` test counter seen (the number of passing tests);
  * whether the log contains `All tests passed`;
  * the number of `*_test.dart` files in the test directory.

It is informational only: the workflow step that runs `flutter test` has already
exited non-zero on failure before this script is reached. No secret value is
printed — only counts and status text.

Usage: report_flutter_tests.py <log-file> [test-directory]
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
COUNTER_RE = re.compile(r"\+(\d+)")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    log_path = Path(sys.argv[1])
    test_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("test")

    text = ""
    if log_path.is_file():
        text = log_path.read_text(errors="replace")
    text = ANSI_RE.sub("", text)
    lines = re.split(r"[\r\n]+", text)

    counters = [int(match.group(1)) for line in lines for match in [COUNTER_RE.search(line)] if match]
    passed = max(counters) if counters else 0
    all_passed = any("All tests passed" in line for line in lines)
    failed = any("Some tests failed" in line or "test failed" in line for line in lines)
    skipped = max((int(m.group(1)) for line in lines for m in [re.search(r"~(\d+)", line)] if m), default=0)
    files = sorted(p.name for p in test_dir.glob("*_test.dart")) if test_dir.is_dir() else []

    # Deterministic fallback: count the declarations in the test sources, so the
    # annotation stays useful even when Flutter's reporter output is buffered in a
    # way that hides its progress counters (as on the GitHub runner).
    declared = 0
    if test_dir.is_dir():
        declaration_re = re.compile(r"^\s*(?:test|testWidgets)\(", re.MULTILINE)
        for source in sorted(test_dir.glob("*_test.dart")):
            declared += len(declaration_re.findall(source.read_text(errors="replace")))

    verdict = "FAIL" if (failed and not all_passed) else "PASS"
    if all_passed and passed:
        status = f"{verdict} — +{passed}" + (f" ~{skipped}" if skipped else "") + ": All tests passed!"
    elif all_passed:
        status = f"{verdict} — All tests passed! (reporter counter not captured in the log)"
    elif passed:
        status = f"{verdict} — +{passed} tests reported (summary line not captured)"
    else:
        status = f"{verdict} — step exited 0 (reporter summary not captured in the log)"

    print(
        f"::notice title=Flutter tests::{status} | test files: {len(files)}"
        f" | declared tests: {declared}"
        + (f" ({', '.join(files)})" if files and len(files) <= 12 else "")
    )

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n### Flutter tests\n\n")
            handle.write(f"- Result: {status}\n")
            handle.write(f"- Passing test counter: {passed}\n")
            handle.write(f"- Skipped: {skipped}\n")
            handle.write(f"- Test files ({len(files)}): {', '.join(files) or 'none found'}\n")
            handle.write(f"- Declared `test()`/`testWidgets()` calls in those files: {declared}\n")

    return 1 if (failed and not all_passed) else 0


if __name__ == "__main__":
    sys.exit(main())
