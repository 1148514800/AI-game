"""Package a natively verified Phase 4 commit and check combined extraction."""
from pathlib import Path
from runpy import run_path

if __name__ == "__main__":
    run_path(str(Path(__file__).with_name("package-phase3_1.py")))["main"](phase4=True)
