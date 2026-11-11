"""Compare `openapi-before.json` with `openapi-after.json` and print pass/fail
for each of the spec's five OpenAPI conditions.

Run: `python compare_openapi.py [before.json] [after.json]` (defaults: the two
files next to this script). Exit code 0 only when every condition passes.
"""

import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

PAGE_OPERATIONS = {
    ("/api/public/organizations/{slug}/layout/{layout}", "get"): (
        "get_organization_layout_api_public_organizations__slug__layout__layout__get"
    ),
    ("/api/public/organizations/{slug}/groups/{group_id}/terms", "get"): (
        "get_organization_group_terms_api_public_organizations__slug__groups__group_id__terms_get"
    ),
    ("/api/public/organizers/{slug}/items", "get"): (
        "get_organization_owner_items_api_public_organizers__slug__items_get"
    ),
    ("/api/public/organizers/{slug}/meetings", "get"): (
        "get_organization_owner_meetings_api_public_organizers__slug__meetings_get"
    ),
    ("/api/public/parties/{party_id}", "get"): (
        "get_party_profile_api_public_parties__party_id__get"
    ),
    ("/api/public/parties/{party_id}/items", "get"): (
        "get_party_owner_items_api_public_parties__party_id__items_get"
    ),
    ("/api/public/parties/{party_id}/meetings", "get"): (
        "get_party_owner_meetings_api_public_parties__party_id__meetings_get"
    ),
}
HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def _operations(doc: dict) -> dict[tuple[str, str], dict]:
    return {
        (path, method): operation
        for path, item in doc["paths"].items()
        for method, operation in item.items()
        if method in HTTP_METHODS
    }


def main() -> int:
    before_path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "openapi-before.json"
    after_path = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "openapi-after.json"
    before = json.loads(before_path.read_text(encoding="utf-8"))
    after = json.loads(after_path.read_text(encoding="utf-8"))
    results: list[tuple[str, bool, str]] = []

    restored = copy.deepcopy(after)
    restored_ops = _operations(restored)
    for key in PAGE_OPERATIONS:
        if key in restored_ops:
            restored_ops[key]["tags"] = ["groups"]
    results.append(("1 deep-equal after resetting the 7 tags to groups", restored == before, ""))

    results.append(
        ("2 paths key order unchanged", list(before["paths"]) == list(after["paths"]), "")
    )

    after_ops = _operations(after)
    mismatched = [
        f"{path} {method}: {after_ops.get((path, method), {}).get('operationId')}"
        for (path, method), expected in PAGE_OPERATIONS.items()
        if after_ops.get((path, method), {}).get("operationId") != expected
    ]
    results.append(
        ("3 operationIds equal the gap-analysis table", not mismatched, "; ".join(mismatched))
    )

    tagged_pages = {key for key, op in after_ops.items() if "pages" in op.get("tags", [])}
    wrong_tags = [
        f"{path} {method}: {after_ops[(path, method)].get('tags')}"
        for (path, method) in PAGE_OPERATIONS
        if after_ops.get((path, method), {}).get("tags") != ["pages"]
    ]
    extra = sorted(f"{p} {m}" for p, m in tagged_pages - set(PAGE_OPERATIONS))
    results.append(
        (
            "4 exactly the 7 operations tagged pages, no other tag",
            not wrong_tags and not extra,
            "; ".join(wrong_tags + extra),
        )
    )

    schemas = after["components"]["schemas"]
    pages_components = [name for name in schemas if name.startswith("app__pages__")]
    ok = (
        len(schemas) == 205
        and not pages_components
        and "app__groups__schemas__ReservedByResponse" in schemas
    )
    detail = f"count={len(schemas)}, app__pages__*={pages_components}"
    results.append(("5 205 components, no app__pages__*, groups ReservedByResponse", ok, detail))

    for name, passed, info in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name}" + (f"  ({info})" if info else ""))
    return 0 if all(passed for _, passed, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main())
