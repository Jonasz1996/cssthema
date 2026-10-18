"""Schrijft het OpenAPI-document naar een bestand (gebruikt door CI en de frontend)."""

import json
import sys
from pathlib import Path

from cssthema.main import create_app


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    spec = create_app().openapi()
    target.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OpenAPI geschreven naar {target}")


if __name__ == "__main__":
    main()
