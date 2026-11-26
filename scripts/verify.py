"""Run Phase 3.1 checks without model credentials and save separate evidence."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TIMEZONE = datetime.timezone(datetime.timedelta(hours=8))
stamp = datetime.datetime.now(TIMEZONE).strftime("%Y%m%d-%H%M%S-%f")
evidence = ROOT / "evidence" / "phase3_1" / f"verification-{stamp}"
evidence.mkdir(parents=True)
environment = {name: os.environ[name] for name in (
    "PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TMPDIR", "TMP", "TEMP",
    "PLAYWRIGHT_BROWSERS_PATH", "LANG", "LC_ALL",
) if name in os.environ}
environment.update(MISTSEA_EVIDENCE=str(evidence), LLM_ENABLED="false", LLM_AUTONOMY_ENABLED="false",
                   LLM_MOCK_AUTONOMY_ENABLED="false", npm_config_fetch_retries="0")
results = []


def run(command, filename, *, extra=None, skip=None):
    started = datetime.datetime.now(TIMEZONE).isoformat()
    path = evidence / filename
    code = None
    with path.open("w") as output:
        if skip:
            print(skip, file=output)
        else:
            try:
                code = subprocess.run(command, cwd=ROOT, env={**environment, **(extra or {})},
                                      stdout=output, stderr=subprocess.STDOUT, check=False).returncode
            except OSError as error:
                print(error, file=output)
                code = 1
    result = {"command": " ".join(command), "exitCode": code, "startedAt": started,
              "log": str(path.relative_to(ROOT))}
    if skip:
        result["notRun"] = skip
    results.append(result)
    print(result, flush=True)
    (evidence / "command-results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    return code


print(f"Evidence: {evidence.relative_to(ROOT)}", flush=True)
install = run(["npm", "ci"], "npm-ci.log")
if install:
    run(["npm", "ci", "--ignore-scripts"], "npm-ci-ignore-scripts.log")
run(["node", "scripts/dev-smoke.mjs"], "dev.log")
run(["npm", "run", "typecheck"], "typecheck.log")
run(["node", "node_modules/typescript/bin/tsc", "-p", "scripts/performance/tsconfig.json"], "performance-typecheck.log")
run(["npm", "test"], "unit-test.log")
run(["npm", "run", "test:integration"], "integration.log")
run(["node", "--import", "tsx", "scripts/regress-phase3_1.ts"], "follow-ticks.log")
run(["npm", "run", "test:e2e", "--", "--list"], "e2e-list.log")
run(["npm", "run", "test:e2e"], "e2e.log", extra={"DEBUG": "pw:webserver"})
build = run(["npm", "run", "build"], "build.log", extra={"LLM_API_KEY": "phase2-build-dummy-key-do-not-expose"})
skip_build = "No fresh production build." if build else None
run(["node", "scripts/assert-client-no-secret.mjs"], "client-key-sentinel.log", skip=skip_build)
run(["node", "scripts/production-smoke.mjs"], "production-smoke.log", skip=skip_build)
run(["node", "--check", "scripts/soak-phase3.mjs"], "soak-syntax.log")
sys.exit(any(result["exitCode"] != 0 for result in results))
