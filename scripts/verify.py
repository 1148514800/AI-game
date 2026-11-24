"""Run Phase 1 checks and keep each invocation's evidence alongside the game."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TIMEZONE = datetime.timezone(datetime.timedelta(hours=8))
stamp = datetime.datetime.now(TIMEZONE).strftime("%Y%m%d-%H%M%S-%f")
evidence = ROOT / "evidence" / "phase1" / f"verification-{stamp}"
evidence.mkdir(parents=True)
environment = {**os.environ, "MISTSEA_EVIDENCE": str(evidence)}
commands = [
    (["npm", "ci"], "npm-ci.log"),
    (["npm", "run", "typecheck"], "typecheck.log"),
    (["npm", "test"], "unit-test.log"),
    (["npm", "run", "test:e2e"], "e2e.log"),
    (["npm", "run", "build"], "build.log"),
    (["node", "scripts/production-smoke.mjs"], "production-smoke.log"),
]
results = []
for command, filename in commands:
    start = datetime.datetime.now(TIMEZONE).isoformat()
    path = evidence / filename
    with path.open("w") as output:
        code = subprocess.run(command, cwd=ROOT, env=environment, stdout=output,
                              stderr=subprocess.STDOUT, check=False).returncode
    result = {"command": " ".join(command), "exitCode": code, "startedAt": start,
              "log": str(path.relative_to(ROOT))}
    results.append(result)
    print(result, flush=True)
    (evidence / "command-results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    if command == ["npm", "ci"] and code != 0:
        break
sys.exit(any(result["exitCode"] != 0 for result in results))
