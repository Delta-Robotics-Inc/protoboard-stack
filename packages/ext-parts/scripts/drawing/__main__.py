"""`python -I <ext-parts>/scripts/drawing ...` and `python -m drawing ...` (from the scripts folder).

When Python runs a folder it may put the folder itself first on sys.path; this package's `inspect.py` would then
shadow the standard library's `inspect` for every library loaded after it. The folder is taken off the path, and
only its parent (this package's own home, never the current folder) is put on it.
"""
import os
import sys

_here = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _here]
_parent = os.path.dirname(_here)
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from drawing.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
