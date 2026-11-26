#!/usr/bin/env python3
"""Coordinator packaging only: committed source + all evidence, complementary <25MB ZIPs."""
import argparse, hashlib, json, subprocess, zipfile, zlib
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone, timedelta

BASELINE = "842342a1021751d0e33ac7b2a3db27f0e0bca9f1"
PDF_SHA = "8623390d64c8f0684e89749247cbf2d3206f3c859bd0c7e34f8567a5d252efc7"
LIMIT, TARGET = 25_000_000, 23_000_000

def sha(data): return hashlib.sha256(data).hexdigest()

def forbidden(name):
    parts = PurePosixPath(name).parts
    return (name.startswith("/") or ".." in parts
        or any(p in {".git", "node_modules", "release", "saves", "__pycache__"} for p in parts)
        or any(".sqlite" in p for p in parts)
        or (PurePosixPath(name).name.startswith(".env") and name != ".env.example")
        or name.endswith("/trace.zip")
        or (name.startswith("assets/source/") and name.endswith(".zip")))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    p.add_argument("--prefix", type=Path, default=Path("/workspace/mistsea-phase3_1-AG-5"))
    args=p.parse_args(); root=args.root.resolve(); prefix=args.prefix.resolve()
    def git(*a): return subprocess.check_output(["git", *a], cwd=root)
    assert not git("status", "--porcelain").strip(), "Commit intended work first; refusing dirty delivery"
    head=git("rev-parse", "HEAD").decode().strip()
    names=sorted(n for n in git("ls-files", "-z").decode().split("\0") if n)
    assert all(not forbidden(n) for n in names), "Forbidden tracked content"
    blobs={n:git("show",f"{head}:{n}") for n in names}
    assert all((root/n).read_bytes()==b for n,b in blobs.items()), "Worktree mismatch"
    assert sha(blobs["docs/AI_Game_Research_and_Design_v2.pdf"])==PDF_SHA
    historical=git("ls-tree", "-r", "--name-only", BASELINE, "evidence").decode().splitlines()
    assert all(blobs[n]==git("show",f"{BASELINE}:{n}") for n in historical), "Historical evidence modified"
    assets=json.loads(blobs["assets/manifest.json"])["assets"]
    assert {a["outputPath"] for a in assets}=={n for n in names if n.startswith("public/assets/")}
    assert all(sha(blobs[a["outputPath"]])==a["sha256"] for a in assets)
    metadata=f"AG-5 / Phase3.1 only\nBaseline: {BASELINE}\nFinal local commit: {head}\nLive Phase3.1: NOT VERIFIED; no actual-call budget authorized.\nPhase3 Live: USER reported autonomous thought/collection verified; no invented score.\nPhase2 Live: USER reported verified; not agent measurement.\nNo push / PR / deployment / Phase4.\n"
    blobs["DELIVERY_COMMIT.txt"]=metadata.encode()
    core=[n for n in blobs if not n.startswith("evidence/")]
    parts=[("core",core)]; batch=[]; size=0; i=1
    for name in sorted(n for n in blobs if n.startswith("evidence/")):
        estimate=len(zlib.compress(blobs[name],9))+2*len(("mistsea-phase3_1/"+name).encode())+150
        assert estimate<TARGET, f"Single file needs special split: {name}"
        if batch and size+estimate>TARGET:
            parts.append((f"evidence-{i:02}",batch)); i+=1; batch=[]; size=0
        batch.append(name); size+=estimate
    if batch: parts.append((f"evidence-{i:02}",batch))
    outputs=[Path(str(prefix)+"-"+part+".zip") for part,_ in parts]
    infofile=Path(str(prefix)+"-delivery-info.json")
    assert not any(p.exists() for p in [*outputs,infofile]), "Refusing overwrite of delivery"
    info={"baseline":BASELINE,"finalCommit":head,"workspace":str(root),"time":datetime.now(timezone(timedelta(hours=8))).isoformat(),"phase3_1Live":"NOT VERIFIED; no actual-call budget", "phase3Live":"USER reported thought/collection verified, not this round measurement","phase2Live":"USER verified, not agent evidence","report":str(root/"docs/PHASE3_1_REPORT.md"),"archives":[],"checks":{"historicalEvidenceExact":len(historical),"runtimeAssetsVerified":len(assets),"pdfSha256":PDF_SHA}}
    seen={}
    for (part,selected),path in zip(parts,outputs):
        with zipfile.ZipFile(path,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for n in selected: z.writestr("mistsea-phase3_1/"+n,blobs[n])
        assert path.stat().st_size<LIMIT, "Split further, never drop required content"
        with zipfile.ZipFile(path) as z:
            assert z.testzip() is None
            assert len(z.namelist())==len(set(z.namelist()))
            for n in z.namelist():
                rel=n.removeprefix("mistsea-phase3_1/")
                assert n.startswith("mistsea-phase3_1/") and not forbidden(rel) and rel not in seen
                b=z.read(n); assert b==blobs[rel]; seen[rel]=sha(b)
        digest=sha(path.read_bytes())
        Path(str(path)+".sha256").write_text(digest+"  "+path.name+"\n")
        info["archives"].append({"part":part,"path":str(path),"bytes":path.stat().st_size,"sha256":digest,"files":len(selected)})
    assert set(seen)==set(blobs)
    info["checks"].update({"allTrackedBytesExact":len(names),"allCrcPassed":True,"noDuplicateUnsafeOrSecretPaths":True,"allPartsBelow25000000":True,"allCommittedEvidenceIncluded":True,"reproducibleBinaryPlaywrightTracesExcluded":True})
    # Extract all complementary parts into a genuinely empty directory, compare
    # filesystem bytes against every committed file, then remove only this tempdir.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="mistsea-phase3_1-restore-") as restored:
        target=Path(restored)
        for archive in outputs:
            with zipfile.ZipFile(archive) as z: z.extractall(target)
        actual={str(p.relative_to(target/"mistsea-phase3_1")):p.read_bytes()
                for p in (target/"mistsea-phase3_1").rglob("*") if p.is_file()}
        assert actual==blobs, "Real combined extraction is not byte-exact"
        info["checks"].update({"actualCombinedExtractionByteExact":True,
                               "restoredFiles":len(actual)})
    infofile.write_text(json.dumps(info,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(info,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
