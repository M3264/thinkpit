#!/usr/bin/env python3
"""Generate deployment credentials locally without printing their values."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parent.parent
key_dir = root / "secrets"
key_dir.mkdir(mode=0o700, exist_ok=True)
key_dir.chmod(0o700)
key = key_dir / "deployment.key"
if not key.exists():
    fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_hex(32) + "\n")
# Compose mounts the key as a file; the non-root application must be able to read it.
# Its parent directory remains private on the host.
key.chmod(0o644)
env = root / ".env"
if not env.exists():
    fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("THINKPIT_USERNAME=admin\n")
        f.write("THINKPIT_PASSWORD=" + secrets.token_urlsafe(32) + "\n")
        f.write("POSTGRES_PASSWORD=" + secrets.token_hex(24) + "\n")
print("Deployment credentials are ready in .env and secrets/deployment.key. Existing values were preserved.")
