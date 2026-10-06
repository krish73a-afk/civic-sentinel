"""Local presentation switch. No public API changes authentication mode."""
from pathlib import Path
import argparse

def set_mode(mode, folder):
    if mode not in ("firebase", "local_demo"):
        raise ValueError("Choose firebase or local_demo.")
    destination = folder / ".auth-mode"
    temporary = folder / ".auth-mode.tmp"
    temporary.write_text(mode + "\n", encoding="utf-8")
    temporary.replace(destination)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Switch the local Civic Sentinel presentation mode.")
    parser.add_argument("mode", choices=["firebase", "local_demo"])
    arguments = parser.parse_args()
    set_mode(arguments.mode, Path(__file__).resolve().parent)
    print("Authentication enabled." if arguments.mode == "firebase" else "Demo mode enabled. Sign-in is hidden on this computer.")
    print("Refresh http://localhost:5500/ to use the selected mode.")
