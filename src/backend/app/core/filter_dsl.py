"""Shared filter-DSL primitives: regex constants and the operator allowlist
only — deliberately NOT a shared parser. `product/query_service.py` (4-part
filter grammar) and `plugin/query_service.py` (3-part filter grammar, distinct
from product's) each keep their own parser per spec.md's Reusability note;
this module exists so both validate `pluginId`/`jsonPath` segments and
operators against the exact same rules.
"""

from __future__ import annotations

import re

# `pluginId` / `jsonPath` segment validation.
IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+$")

# Allowed filter operators.
ALLOWED_OPERATORS = frozenset({"eq", "gt", "lt", "exists", "bool"})
