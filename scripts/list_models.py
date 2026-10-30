"""Print the model IDs your Meta Model API key can use, and check our config.

  python scripts/list_models.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sakshi import config  # noqa: E402
from sakshi.meta.client import sync_client  # noqa: E402

ids = sorted(m.id for m in sync_client().models.list())
print("Available:", *ids, sep="\n  ")
for label, want in (("SAM", config.SAM_MODEL), ("Spark", config.SPARK_MODEL),
                    ("Wonder", config.WONDER_MODEL), ("Voice", config.VOICE_MODEL)):
    mark = "ok" if want in ids else "NOT LISTED - set the env var in .env"
    print(f"{label:<7} {want:<28} {mark}")
