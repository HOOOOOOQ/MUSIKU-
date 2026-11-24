#!/usr/bin/env python3
"""Prove that backend secrets are not embedded in a built APK.

Usage: scan_apk_secrets.py <path-to-apk>

The APK is a ZIP container: Dart build-time constants land in
`assets/flutter_assets/kernel_blob.bin` (debug) or `lib/*/libapp.so` (release),
and both are compressed, so the archive members are decompressed before being
searched. Every secret supplied through the environment is looked up as raw
bytes; only booleans and archive member names are printed — never a value.

Environment variables inspected (all optional, skipped when empty):
  MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET, GOOGLE_CLIENT_SECRET,
  PAYMENT_SECRET_KEY, PAYMENT_WEBHOOK_SECRET, SMTP_PASSWORD,
  STORAGE_SECRET_KEY, LICENSED_MUSIC_API_KEY, LICENSED_ANIME_API_KEY,
  GITHUB_BUILD_TOKEN, ADMIN_PASSWORD

Additional structural assertions:
  * no member contains a `mongodb+srv://` or `mongodb://` connection string;
  * no member contains a Google OAuth client secret prefix (`GOCSPX-`);
  * no keystore material (`key.properties`, `.jks`, `.keystore`) is packaged.

Exit code 1 on any finding, so the CI step fails the build.
"""

from __future__ import annotations

import os
import re
import sys
import zipfile

SECRET_ENV_VARS = (
    "MONGODB_URI",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "PAYMENT_SECRET_KEY",
    "PAYMENT_WEBHOOK_SECRET",
    "SMTP_PASSWORD",
    "STORAGE_SECRET_KEY",
    "LICENSED_MUSIC_API_KEY",
    "LICENSED_ANIME_API_KEY",
    "GITHUB_BUILD_TOKEN",
    "ADMIN_PASSWORD",
)

FORBIDDEN_PATTERNS = (
    ("MongoDB connection string", re.compile(rb"mongodb(\+srv)?://[^\s\"']{8,}")),
    ("Google OAuth client secret", re.compile(rb"GOCSPX-[A-Za-z0-9_-]{10,}")),
    ("AWS-style secret key", re.compile(rb"(?i)aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{20,}")),
    ("PEM private key", re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
)

FORBIDDEN_MEMBER_SUFFIXES = ("key.properties", ".jks", ".keystore", ".p12", ".env")

# Values shorter than this produce false positives inside compressed binaries.
MINIMUM_SCAN_LENGTH = 12


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    apk_path = sys.argv[1]
    if not os.path.isfile(apk_path):
        print(f"::error title=APK scan::artifact not found at {apk_path}")
        return 1

    secrets = {
        name: value
        for name in SECRET_ENV_VARS
        if (value := os.environ.get(name, "")) and len(value) >= MINIMUM_SCAN_LENGTH
    }
    skipped = [name for name in SECRET_ENV_VARS if name not in secrets]

    findings: list[str] = []
    scanned_members = 0
    scanned_bytes = 0

    with zipfile.ZipFile(apk_path) as archive:
        names = archive.namelist()
        for name in names:
            lowered = name.lower()
            if any(lowered.endswith(suffix) for suffix in FORBIDDEN_MEMBER_SUFFIXES):
                findings.append(f"packaged signing/environment material: {name}")

        for name in names:
            try:
                with archive.open(name) as handle:
                    data = handle.read()
            except (zipfile.BadZipFile, RuntimeError, OSError):
                continue
            scanned_members += 1
            scanned_bytes += len(data)

            for secret_name, value in secrets.items():
                if value.encode() in data:
                    findings.append(f"{secret_name} value found inside {name}")

            for label, pattern in FORBIDDEN_PATTERNS:
                if pattern.search(data):
                    findings.append(f"{label} pattern found inside {name}")

    size = os.path.getsize(apk_path)
    print("### APK secret scan\n")
    print(f"- Artifact: `{apk_path}` ({size:,} bytes)")
    print(f"- Members decompressed and scanned: {scanned_members} ({scanned_bytes:,} bytes)")
    print(f"- Secret values compared: {len(secrets)} ({', '.join(sorted(secrets)) or 'none supplied'})")
    if skipped:
        print(f"- Not supplied to this job (skipped): {', '.join(skipped)}")
    print(f"- Structural patterns checked: {len(FORBIDDEN_PATTERNS)}")
    print(f"- Signing/environment files packaged: {'yes' if any('signing/environment material' in f for f in findings) else 'no'}")

    if findings:
        print("\n**Findings (values are never printed):**\n")
        for finding in sorted(set(findings)):
            print(f"- {finding}")
        print(f"\n::error title=APK secret scan:: {len(set(findings))} finding(s): backend secret material is embedded in the APK")
        return 1

    print("\nResult: **PASS** — no backend secret value or credential pattern was found in the APK.")
    print(
        f"::notice title=APK secret scan::PASS — {scanned_members} members decompressed, "
        f"{len(secrets)} secret values compared, {len(FORBIDDEN_PATTERNS)} credential patterns checked, "
        f"{size:,} byte artifact; no backend secret embedded"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
