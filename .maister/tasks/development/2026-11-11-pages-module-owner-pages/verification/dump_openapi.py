"""Write the backend's OpenAPI document as JSON to the path given as argument.

Run from `src/backend`: `uv run python <path>/dump_openapi.py <output.json>`.
No server and no database: `app.openapi()` does not run the lifespan.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from app.main import app  # noqa: E402


def main() -> None:
    output_path = sys.argv[1]
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(app.openapi(), handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(output_path)


if __name__ == "__main__":
    main()
