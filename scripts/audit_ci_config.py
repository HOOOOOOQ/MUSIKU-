#!/usr/bin/env python3
"""Validate GitHub Actions configuration for MUSIKU+ without revealing values.

Reads candidate secrets/variables from the environment, checks presence and
*shape* (scheme, suffix, placeholder text, minimum length, distinctness) and
emits:

  * a Markdown table on stdout — the workflow appends it to the job summary;
  * GitHub Actions outputs (`atlas_ready`, `google_ready`, `jwt_ready`,
    `signing_ready`, `api_base_url_ready`, `all_required_ready`).

Nothing but names, booleans and category labels is ever printed. Secret values
are never written to stdout, the summary, outputs, files or artifacts. When a
value has the wrong shape the message names the expectation, not the value.

Exit code is 1 only in strict mode (`STRICT=true`, used for `push`/manual runs)
when a required item is missing or looks like a placeholder; pull requests stay
informational so fork PRs are not blocked by inaccessible secrets.
"""

from __future__ import annotations

import os
import sys

PLACEHOLDER_MARKERS = (
    "change-me",
    "changeme",
    "user:password",
    "your-cluster",
    "your_cluster",
    "<cluster>",
    "example.invalid",
    "xxxx",
    "todo",
    "placeholder",
    "replace-me",
)


def classify(value: str) -> str:
    """Return a safe label for a configuration value."""
    if not value:
        return "missing"
    lowered = value.strip().lower()
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        return "placeholder"
    return "present"


def check_mongodb_uri(value: str) -> str:
    state = classify(value)
    if state != "present":
        return state
    if value.startswith("mongodb+srv://"):
        return "present (mongodb+srv, TLS)"
    if value.startswith("mongodb://"):
        return "present (mongodb:// — Atlas expects mongodb+srv)"
    return "invalid scheme"


def check_client_id(value: str) -> str:
    state = classify(value)
    if state != "present":
        return state
    return "present (OAuth client ID shape)" if value.endswith(".apps.googleusercontent.com") else "present (unexpected client ID shape)"


def check_secret_strength(value: str, minimum: int = 32) -> str:
    state = classify(value)
    if state != "present":
        return state
    return f"present (meets {minimum}-character minimum)" if len(value) >= minimum else f"present but shorter than {minimum} characters"


def check_base_url(value: str) -> str:
    state = classify(value)
    if state != "present":
        return state
    if not value.startswith(("https://", "http://")):
        return "invalid scheme"
    return "present (http/https origin)"


def main() -> int:
    strict = os.environ.get("STRICT", "false").lower() == "true"

    mongodb_uri = os.environ.get("MONGODB_URI", "")
    jwt_secret = os.environ.get("JWT_SECRET", "")
    jwt_refresh_secret = os.environ.get("JWT_REFRESH_SECRET", "")
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    google_web_client_id = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
    web_client_from_vars = os.environ.get("GOOGLE_WEB_CLIENT_ID_VAR", "")
    api_base_url = os.environ.get("API_BASE_URL", "")

    keystore = os.environ.get("ANDROID_KEYSTORE_BASE64", "")
    keystore_password = os.environ.get("ANDROID_KEYSTORE_PASSWORD", "")
    key_alias = os.environ.get("ANDROID_KEY_ALIAS", "")
    key_password = os.environ.get("ANDROID_KEY_PASSWORD", "")
    github_build_token = os.environ.get("GITHUB_BUILD_TOKEN", "")

    jwt_distinct = bool(jwt_secret) and bool(jwt_refresh_secret) and jwt_secret != jwt_refresh_secret
    jwt_state = "missing" if not (jwt_secret and jwt_refresh_secret) else (
        "present (access and refresh use different keys)" if jwt_distinct else "present but both JWT secrets are identical"
    )

    rows = [
        ("MONGODB_URI", "secret", "Atlas connection string (backend + CI only)", check_mongodb_uri(mongodb_uri)),
        ("JWT_SECRET", "secret", "Access token signing key", check_secret_strength(jwt_secret)),
        ("JWT_REFRESH_SECRET", "secret", "Refresh token signing key", check_secret_strength(jwt_refresh_secret)),
        ("JWT pair", "derived", "Access and refresh keys must differ", jwt_state),
        ("GOOGLE_CLIENT_ID", "secret", "Android OAuth client (package + SHA-1)", check_client_id(google_client_id)),
        ("GOOGLE_WEB_CLIENT_ID", "secret", "Web OAuth client = ID-token audience", check_client_id(google_web_client_id)),
        ("GOOGLE_WEB_CLIENT_ID", "variable", "Optional public fallback for builds", check_client_id(web_client_from_vars)),
        ("API_BASE_URL / API_URL", "variable", "Public backend origin baked into the APK", check_base_url(api_base_url)),
        ("ANDROID_KEYSTORE_BASE64", "secret", "Release keystore (optional)", classify(keystore)),
        ("ANDROID_KEYSTORE_PASSWORD", "secret", "Keystore password (optional)", classify(keystore_password)),
        ("ANDROID_KEY_ALIAS", "secret", "Key alias (optional)", classify(key_alias)),
        ("ANDROID_KEY_PASSWORD", "secret", "Key password (optional)", classify(key_password)),
        ("GITHUB_BUILD_TOKEN", "secret", "Admin build status (optional)", classify(github_build_token)),
    ]

    print("### CI configuration audit\n")
    print("Presence and shape only — no secret value is printed, stored or uploaded.\n")
    print("| Name | Kind | Purpose | State |")
    print("|---|---|---|---|")
    for name, kind, purpose, state in rows:
        print(f"| `{name}` | {kind} | {purpose} | {state} |")

    atlas_ready = check_mongodb_uri(mongodb_uri).startswith("present") and jwt_distinct
    google_ready = classify(google_web_client_id) == "present" or classify(web_client_from_vars) == "present"
    android_google_ready = classify(google_client_id) == "present"
    signing_ready = all(
        classify(value) == "present" for value in (keystore, keystore_password, key_alias, key_password)
    )
    api_ready = check_base_url(api_base_url).startswith("present")

    required = {
        "MONGODB_URI": check_mongodb_uri(mongodb_uri).startswith("present"),
        "JWT_SECRET/JWT_REFRESH_SECRET": jwt_distinct,
        "GOOGLE_WEB_CLIENT_ID": google_ready,
        "GOOGLE_CLIENT_ID": android_google_ready,
    }
    missing = sorted(name for name, ok in required.items() if not ok)

    print("\n**Required configuration**\n")
    for name, ok in required.items():
        print(f"- {name}: {'detected' if ok else 'NOT detected'}")
    print("\n**Optional configuration**\n")
    print(f"- Android release signing: {'all four secrets detected' if signing_ready else 'not configured — debug APK only'}")
    print(f"- Public API origin for APK builds: {'detected' if api_ready else 'not set — the APK embeds the non-functional example.invalid default'}")
    print(f"- GitHub build-status token: {classify(github_build_token)}")
    print("\nSecret values are never echoed, written to files, uploaded as artifacts, or exposed through the API.")

    outputs = os.environ.get("GITHUB_OUTPUT")
    if outputs:
        with open(outputs, "a", encoding="utf-8") as handle:
            handle.write(f"atlas_ready={'true' if atlas_ready else 'false'}\n")
            handle.write(f"google_ready={'true' if google_ready else 'false'}\n")
            handle.write(f"android_google_ready={'true' if android_google_ready else 'false'}\n")
            handle.write(f"jwt_ready={'true' if jwt_distinct else 'false'}\n")
            handle.write(f"signing_ready={'true' if signing_ready else 'false'}\n")
            handle.write(f"api_base_url_ready={'true' if api_ready else 'false'}\n")
            handle.write(f"all_required_ready={'true' if not missing else 'false'}\n")
            handle.write(f"missing_required={' '.join(missing)}\n")

    if strict and missing:
        # Names only: safe to print, and it tells the owner exactly what to add.
        print(f"\n::error title=Missing repository configuration::Required items not detected: {', '.join(missing)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
