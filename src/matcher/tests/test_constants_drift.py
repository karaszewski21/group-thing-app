"""`rules.py` is the one home of the matcher constants (M5): the backend's
`limits.py` keeps only `REMINDER_LEAD`, at the same value, and the 4-char
limit agrees with the stored `stem_query_pl`."""

import ast
from datetime import timedelta
from pathlib import Path

import asyncpg

from matcher import rules

_LIMITS = Path(__file__).resolve().parents[2] / "backend" / "app" / "wants" / "domain" / "limits.py"
_MOVED = (
    "MATCH_TOP_N",
    "RETENTION",
    "SCAN_INTERVAL",
    "SCAN_OVERLAP",
    "SIMILARITY_THRESHOLD_WITH_CATEGORY",
    "SIMILARITY_THRESHOLD_WITHOUT_CATEGORY",
    "FORWARD_STATEMENT_TIMEOUT_SECONDS",
)


def _limits() -> dict[str, ast.expr]:
    """The module-level assignments of `limits.py`, parsed, not imported."""
    tree = ast.parse(_LIMITS.read_text(encoding="utf-8"))
    return {
        target.id: node.value
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }


def _timedelta(value: ast.expr) -> timedelta:
    assert isinstance(value, ast.Call)
    assert isinstance(value.func, ast.Name) and value.func.id == "timedelta"
    assert not value.args
    return timedelta(**{kw.arg: ast.literal_eval(kw.value) for kw in value.keywords if kw.arg})


def test_backendLimits_reminderLeadEqualsTheMatchers() -> None:
    assert _timedelta(_limits()["REMINDER_LEAD"]) == rules.REMINDER_LEAD


def test_backendLimits_movedConstantsGone_onlyReminderLeadShared() -> None:
    names = set(_limits())
    matcher_names = {name for name in vars(rules) if name.isupper()}

    assert names & set(_MOVED) == set()
    assert names & matcher_names == {"REMINDER_LEAD"}


async def test_stemQueryPl_shortWordExact_oneCharLongerIsAPrefix(db: asyncpg.Pool) -> None:
    short = "q" * rules.SHORT_WORD_MAX_CHARS
    longer = "q" * (rules.SHORT_WORD_MAX_CHARS + 1)

    assert await db.fetchval("SELECT stem_query_pl($1)::text", short) == f"'{short}':A"
    assert await db.fetchval("SELECT stem_query_pl($1)::text", longer) == f"'{longer}':*A"
