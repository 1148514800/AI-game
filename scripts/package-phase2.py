#!/usr/bin/env python3
"""Package committed AG-3 source and all formal evidence into complementary ZIPs."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import subprocess
import zipfile
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "62c5c2a10dff3afc18dbe875341f3a274ca3b436"
PDF_SHA = "8623390d64c8f0684e89749247cbf2d3206f3c859bd0c7e34f8567a5d252efc7"
LIMIT = 25_000_000
PREFIX = "mistsea-phase2/"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def forbidden(name):
    parts = PurePosixPath(name).parts
    return (
        name.startswith("/") or ".." in parts
        or any(p in {".git", "node_modules", "release", "saves", "__pycache__"} for p in parts)
        or any(".sqlite" in p for p in parts)
        or (PurePosixPath(name).name.startswith(".env") and name != ".env.example")
        or name.endswith("/trace.zip")
        or (name.startswith("assets/source/") and name.endswith(".zip"))
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-prefix", type=Path, default=ROOT.parent / "mistsea-phase2-AG-3")
    args = parser.parse_args()
    if git("status", "--porcelain").strip():
        raise SystemExit("Commit intended changes first; refusing a dirty source delivery.")
    head = git("rev-parse", "HEAD").decode().strip()
    names = sorted(p for p in git("ls-files", "-z").decode().split("\0") if p)
    assert names and all(not forbidden(n) for n in names), "Forbidden tracked delivery path"
    blobs = {n: git("show", f"{head}:{n}") for n in names}
    assert all((ROOT / n).read_bytes() == b for n, b in blobs.items()), "Worktree/commit mismatch"
    seal = json.loads(blobs["evidence/phase2/final-runtime-source-hashes.json"])
    assert all(digest(blobs[n]) == h for n, h in seal.items()), "Validated runtime changed"
    manifest = json.loads(blobs["assets/manifest.json"])
    assets = {a["outputPath"]: a["sha256"] for a in manifest["assets"]}
    actual_assets = {n for n in names if n.startswith("public/assets/")}
    assert set(assets) == actual_assets, "Manifest/runtime file set mismatch"
    assert all(digest(blobs[n]) == h for n, h in assets.items()), "Runtime asset hash mismatch"
    assert digest(blobs["docs/AI_Game_Research_and_Design_v2.pdf"]) == PDF_SHA
    historical = git("ls-tree", "-r", "--name-only", BASELINE, "evidence", "docs/PHASE0_REPORT.md", "docs/PHASE1_REPORT.md").decode().splitlines()
    assert all(blobs[n] == git("show", f"{BASELINE}:{n}") for n in historical), "Historical evidence changed"
    metadata = f"AG-3 / Phase2\nBaseline: {BASELINE}\nFinal local commit: {head}\nBranch: {git('branch', '--show-current').decode().strip()}\nLive: NOT VERIFIED; no dedicated key or actual-call authorization.\nNo push / PR / deployment / Phase3.\n"
    prefix = args.output_prefix.resolve()
    outputs = {part: Path(str(prefix) + f"-{part}.zip") for part in ("core", "evidence")}
    info_path = Path(str(prefix) + "-delivery-info.json")
    check_path = Path(str(prefix) + "-packaging-check.json")
    assert not any(p.exists() for p in [*outputs.values(), info_path, check_path]), "Refusing to overwrite an existing delivery"
    prefix.parent.mkdir(parents=True, exist_ok=True)
    verification = "evidence/phase2/verification-20261125-004035-665303"
    results = json.loads(blobs[verification + "/command-results.json"])
    assert len(results) == 12 and all(r["exitCode"] == 0 for r in results)
    def count(log, pattern):
        return int(re.search(pattern, blobs[verification + "/" + log].decode(), re.M).group(1))
    tests = {
        "unit": count("unit-test.log", r"^ℹ tests (\d+)$"),
        "localHttpWsIntegration": count("integration.log", r"^ℹ tests (\d+)$"),
        "browser": count("e2e.log", r"^\s*(\d+) passed \("),
        "finalCommandExitCodes": [r["exitCode"] for r in results],
        "results": str(ROOT / verification / "command-results.json"),
    }
    performance = {}
    for mode, name in (("before", "before-tHNDhF"), ("after", "after-VtaIPH")):
        path = "evidence/phase2/performance/" + name + "/report.json"
        report = json.loads(blobs[path])
        performance[mode] = {"path": str(ROOT / path), "cases": {n: c.get("metrics", c.get("status")) for n, c in report["variants"][0]["cases"].items()}}
    info = {"baseline": BASELINE, "finalCommit": head, "branch": "ag-3-phase2", "time": datetime.now(timezone(timedelta(hours=8))).isoformat(), "live": "NOT VERIFIED; no dedicated key or actual-call authorization", "tests": tests, "performance": performance, "performanceConclusion": "No measured FPS improvement; Linux headless Canvas, WebGL unavailable; Mac not validated", "report": str(ROOT / "docs/PHASE2_REPORT.md"), "primaryScreenshot": str(ROOT / "evidence/phase2/visual-review-final/dialogue-clean-multiturn.png"), "narrowScreenshot": str(ROOT / verification / "dialogue-narrow.png"), "archives": []}
    seen = {}
    for part, path in outputs.items():
        selected = {n: b for n, b in blobs.items() if n.startswith("evidence/") == (part == "evidence")}
        if part == "core":
            selected["DELIVERY_COMMIT.txt"] = metadata.encode()
        with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for n, b in selected.items():
                archive.writestr(PREFIX + n, b)
        size = path.stat().st_size
        assert size < LIMIT, f"{path} is {size} bytes; split evidence rather than drop required content"
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None, "ZIP CRC failure"
            assert len(archive.namelist()) == len(set(archive.namelist()))
            for n in archive.namelist():
                assert n.startswith(PREFIX) and not forbidden(n[len(PREFIX):])
                relative = n[len(PREFIX):]
                assert relative not in seen, "Complementary ZIP overlap"
                data = archive.read(n)
                assert data == selected[relative], "Archive bytes differ"
                seen[relative] = data
        sha = digest(path.read_bytes())
        Path(str(path) + ".sha256").write_text(f"{sha}  {path.name}\n")
        info["archives"].append({"part": part, "path": str(path), "bytes": size, "sha256": sha, "files": len(selected)})
    assert set(seen) == set(blobs) | {"DELIVERY_COMMIT.txt"}
    assert all(seen[n] == b for n, b in blobs.items())
    (ROOT / "DELIVERY_COMMIT.txt").write_text(metadata)
    check = {"allChecksPassed": True, "crc": "PASS", "trackedFilesExact": len(blobs), "historicalFilesUnchanged": len(historical), "runtimeAssetsVerified": len(assets), "validatedRuntimeFilesUnchanged": len(seal), "pdfSha256": PDF_SHA, "allPartsBelowBytes": LIMIT, "forbiddenPaths": 0, "duplicateOrUnsafePaths": 0, "allEvidenceIncluded": True, "head": head, "deliveryMetadataOnlyUntrackedAddition": "DELIVERY_COMMIT.txt (ignored)"}
    check_path.write_text(json.dumps(check, ensure_ascii=False, indent=2) + "\n")
    info["packagingCheck"] = str(check_path)
    info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
