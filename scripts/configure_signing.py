"""Run from mobile/. Never prints secret values; Java-properties values are escaped."""
import base64
import os
from pathlib import Path

def escape(value):
    return ''.join('\\u%04x' % ord(c) if ord(c) > 126 else '\\' + c if c in '\\:=#! ' else '\\n' if c == '\n' else '\\r' if c == '\r' else c for c in value)

path = Path(os.environ['RUNNER_TEMP']) / 'musiku-release.jks'
path.write_bytes(base64.b64decode(os.environ['ANDROID_KEYSTORE_BASE64'], validate=True))
path.chmod(0o600)
values = {'storeFile': str(path), 'storePassword': os.environ['ANDROID_KEYSTORE_PASSWORD'], 'keyAlias': os.environ['ANDROID_KEY_ALIAS'], 'keyPassword': os.environ['ANDROID_KEY_PASSWORD']}
config = Path('android/key.properties')
config.write_text(''.join(f'{key}={escape(value)}\n' for key, value in values.items()))
config.chmod(0o600)
