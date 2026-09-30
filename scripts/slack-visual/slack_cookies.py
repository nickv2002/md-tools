"""Decrypt only the Slack session cookies (d, d-s) from the Chrome Work profile.

Reuses incident-io-migration's extract_cookies helpers, but filters by name before
decrypting: the stock CLI aborts if any unrelated cookie on the host (here `x`) has expired.
Prints JSON with live values; only call it from a shell that captures stdout in a variable.
"""
import json, sys
sys.path.insert(0, "/Users/nick/conductor/workspaces/incident-io-migration/melbourne/tools")
import extract_cookies as ec
from datetime import datetime, timezone

WANT = {"d", "d-s"}
rows = [r for r in ec.read_rows(ec.resolve_profile("Work"), ".slack.com") if r[0] in WANT]
if {r[0] for r in rows} != WANT:
    ec.die("missing Slack session cookie(s); log in to Slack in the Chrome Work profile")
key, now, out = ec.derive_key(), datetime.now(timezone.utc), []
for name, blob, exp_us, secure, httponly, samesite in rows:
    exp = ec.to_datetime(exp_us)
    if exp is not None and exp <= now:
        ec.die(f"cookie {name} expired {exp.isoformat()}; re-log-in to Slack in Chrome Work")
    out.append({"name": name, "value": ec.decrypt(key, blob, name)})
print(json.dumps(out))
