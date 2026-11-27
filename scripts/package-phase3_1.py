"""Package a clean, natively verified Phase 3.1 commit for local delivery."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "842342a1021751d0e33ac7b2a3db27f0e0bca9f1"
PREFIX = "mistsea-phase3_1"
LIMIT = 25_000_000


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def allowed(name):
    path = PurePosixPath(name)
    return (
        not path.is_absolute() and ".." not in path.parts
        and all(part not in {".git", "node_modules", "release", "saves", "__pycache__"} for part in path.parts)
        and all(".sqlite" not in part for part in path.parts)
        and (not path.name.startswith(".env") or name == ".env.example")
        and path.name != "trace.zip" and not (name.startswith("assets/source/") and path.suffix == ".zip")
    )


def main(*, phase4=False):
    phase_dir = "phase4" if phase4 else "phase3_1"
    baseline = "8e4cb58e3f5d137d1b77934ad576ae8082d5c3c1" if phase4 else BASELINE
    prefix = "mistsea-phase4" if phase4 else PREFIX
    label = "AG-6 / Phase 4" if phase4 else "AG-5 / Phase 3.1"
    parser = argparse.ArgumentParser(description=f"Package a clean, natively verified {label} commit for local delivery.")
    parser.add_argument("--verification", required=True, help="Committed native verification directory relative to this checkout")
    parser.add_argument("--out", required=True, type=Path, help="New output directory")
    args = parser.parse_args()
    verification = PurePosixPath(args.verification)
    require(verification.parts[:2] == ("evidence", phase_dir) and len(verification.parts) == 3 and ".." not in verification.parts,
            f"Use a directory under evidence/{phase_dir}")
    require(not args.out.exists(), "Use a new output directory")
    require(not git("status", "--porcelain").strip(), "Package after the coordinator commits the intended changes")
    head = git("rev-parse", "HEAD").decode().strip()
    require(subprocess.run(["git", "merge-base", "--is-ancestor", baseline, head], cwd=ROOT).returncode == 0,
            f"The package commit must descend from the {label} baseline")

    tracked = set(git("ls-tree", "-rz", "--name-only", head).decode().rstrip("\0").split("\0"))
    require(all(allowed(name) for name in tracked), "Generated, private or unsafe path in the Git tree")
    with tarfile.open(fileobj=io.BytesIO(git("archive", "--format=tar", head))) as archive:
        blobs = {}
        for member in archive:
            if member.isdir():
                continue
            require(member.isfile() and member.name in tracked, f"Unexpected archive member {member.name}")
            blobs[member.name] = archive.extractfile(member).read()
    require(set(blobs) == tracked, "Source archive differs from the tracked file set")

    historical = git("diff", "--name-only", baseline, head, "--", "evidence", f":(exclude)evidence/{phase_dir}")
    require(not historical.strip(), "Historical evidence differs from the baseline")
    assets = {entry["outputPath"]: entry["sha256"] for entry in json.loads(blobs["assets/manifest.json"])["assets"]}
    require(set(assets) == {name for name in blobs if name.startswith("public/assets/")}, "Runtime asset file set differs from manifest")
    require(all(sha(blobs[name]) == digest for name, digest in assets.items()), "Runtime asset content differs from manifest")

    def find(name):
        return blobs[str(verification / name)]

    results = json.loads(find("command-results.json"))
    require(results and all(row["exitCode"] == 0 for row in results), "Native verification has a nonzero or missing exit code")
    units = re.search(rb"^\xe2\x84\xb9 pass (\d+)$", find("unit-test.log"), re.M)
    integrations = re.search(rb"^\xe2\x84\xb9 pass (\d+)$", find("integration.log"), re.M)
    browsers = re.search(rb"^\s*(\d+) passed \(", find("e2e.log"), re.M)
    minimum = (74, 6, 15) if phase4 else (58, 5, 13)
    require(all(match and int(match[1]) >= count for match, count in zip((units, integrations, browsers), minimum)),
            "Native logs do not contain the expected regression runs")
    require(json.loads(find("phase31-follow-ticks.json"))["status"] == "PASS", "Missing short real-time tick regression")
    trajectory = json.loads(find("cooperation/trajectory.json"))
    reached = {sample.get("step") for sample in trajectory["trajectory"]}
    require({"A-shared-materials", "B-follow-arrived", "C-crossed-under-keyboard-control",
             "D-promoted-and-harvested", "E-bidirectional-consent", "F-restarted-model-context"} <= reached,
            "Native A–F trajectory is incomplete")
    require(sum(name.startswith(str(verification / "cooperation") + "/") and name.endswith(".png") for name in blobs) >= 9,
            "Missing cooperation screenshots")

    if phase4:
        reports = [json.loads(data) for name, data in blobs.items()
                   if name.startswith(str(verification / "soak-")) and name.endswith("/report.json")]
        require(any(report.get("status") == "PASS" and report.get("elapsedMs", 0) >= 1_800_000
                    and report.get("mockOnly") is True for report in reports),
                "Missing completed native Phase 4 Mock soak")
        screenshots = {"A-three-residents.png", "C-autonomous-bridge.png", "F-loan.png", "H-restart-and-debug.png"}
        require(all(str(verification / "society" / name) in blobs for name in screenshots),
                "Missing Phase 4 browser screenshots")

    blobs["DELIVERY_COMMIT.txt"] = f"{label}\nBaseline: {baseline}\nLocal commit: {head}\nVerification: {verification}\n".encode()
    out = args.out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{prefix}-package-", dir=out.parent) as tmp:
        work = Path(tmp)
        delivery = work / "delivery"
        restored = work / "restored"
        delivery.mkdir()
        restored.mkdir()
        parts = []

        def add_archive(label, names):
            path = delivery / f"{prefix}-{label}.zip"
            with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
                for name in names:
                    bundle.writestr(f"{prefix}/{name}", blobs[name])
            if path.stat().st_size >= LIMIT and len(names) > 1 and label != "core":
                path.unlink()
                middle = len(names) // 2
                add_archive(label + "-1", names[:middle])
                add_archive(label + "-2", names[middle:])
                return
            require(path.stat().st_size < LIMIT, f"{label} exceeds the attachment size limit")
            with zipfile.ZipFile(path) as bundle:
                require(bundle.testzip() is None, f"{label} has a CRC failure")
                require(bundle.namelist() == [f"{prefix}/{name}" for name in names], "Archive path list mismatch")
                require(all(not (restored / name).exists() for name in bundle.namelist()), "Overlapping delivery archives")
                bundle.extractall(restored)
            digest = sha(path.read_bytes())
            path.with_suffix(".zip.sha256").write_text(f"{digest}  {path.name}\n")
            parts.append({"file": path.name, "bytes": path.stat().st_size, "sha256": digest, "files": len(names)})

        add_archive("core", sorted(name for name in blobs if not name.startswith("evidence/")))
        add_archive("evidence", sorted(name for name in blobs if name.startswith("evidence/")))
        restored_root = restored / prefix
        actual = {str(file.relative_to(restored_root)) for file in restored_root.rglob("*") if file.is_file()}
        require(actual == set(blobs) and all((restored_root / name).read_bytes() == data for name, data in blobs.items()),
                "The combined on-disk extraction differs from the commit")
        info = {
            "baseline": baseline, "commit": head, "verification": str(verification), "parts": parts,
            "runtimeAssetsVerified": len(assets), "restoredFilesExact": len(actual), "crc": "PASS",
            ("phase4Live" if phase4 else "phase31Live"): "NOT RUN",
        }
        (delivery / "delivery-info.json").write_text(json.dumps(info, indent=2) + "\n")
        delivery.rename(out)
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
