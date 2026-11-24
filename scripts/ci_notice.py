"""Emit a GitHub Actions notice from a CI log without dumping the entire file.

Usage: python3 scripts/ci_notice.py <log-file> <title> [marker]

GitHub truncates very long annotation messages, keeping the head. Flutter's
`flutter test` output puts a huge widget stack trace at the end, which hides the
failing test name. When the marker (default: the failing-test cross mark) is
present, the excerpt starts 200 characters before it so the failing test and its
exception stay visible; otherwise the tail of the log is used.

Secrets are never printed by this script; it only re-emits log text the workflow
already produced.
"""

from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    log_path = Path(sys.argv[1])
    title = sys.argv[2]
    marker = sys.argv[3] if len(sys.argv) > 3 else '\u274c'
    if not log_path.exists():
        print(f'::notice title={title}::log file {log_path} was not produced')
        return 0
    text = log_path.read_text(errors='replace')
    index = text.find(marker)
    if index == -1:
        excerpt = text[-6000:]
    else:
        excerpt = text[max(0, index - 200): index + 6000]
    encoded = excerpt.replace('%', '%25').replace('\n', '%0A').replace('\r', '%0D')
    print(f'::notice title={title}::{encoded}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
