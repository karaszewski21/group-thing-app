"""`rules.py` is the one home of the matcher constants (M5): the backend's
`limits.py` keeps only `REMINDER_LEAD`, at the same value, and the 4-char
limit agrees with the stored `stem_query_pl`. The constants and the SQL text
the matcher shares with the backend (`EMBEDDING_MODEL_ID`, the visibility
rule) are pinned here too, parsed, never imported."""

import ast
import importlib.util
import re
from datetime import timedelta
from pathlib import Path

import asyncpg

from matcher import rules, statements

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
_LIMITS = _BACKEND / "app" / "wants" / "domain" / "limits.py"
_EMBEDDINGS = _BACKEND / "app" / "embeddings" / "service.py"
_PARITY = _BACKEND / "tests" / "test_wants_visibility_parity.py"
_DOCKERFILE = _BACKEND / "Dockerfile"
_EMBED_PARITY = _BACKEND / "scripts" / "check_embed_parity.py"
_CALL_SITE_PREFIX = re.compile(r"^SELECT .*? WHERE l\.item_id = ANY\(:item_ids\) AND ")
_MOVED = (
    "MATCH_TOP_N",
    "RETENTION",
    "SCAN_INTERVAL",
    "SCAN_OVERLAP",
    "SIMILARITY_THRESHOLD_WITH_CATEGORY",
    "SIMILARITY_THRESHOLD_WITHOUT_CATEGORY",
    "FORWARD_STATEMENT_TIMEOUT_SECONDS",
)


def _assignments(path: Path) -> dict[str, ast.expr]:
    """The module-level assignments of `path`, parsed, not imported."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        target.id: node.value
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }


def _limits() -> dict[str, ast.expr]:
    return _assignments(_LIMITS)


def _sql(text: str) -> str:
    """`text` with whitespace runs collapsed and none next to a parenthesis."""
    return re.sub(r"\s*([()])\s*", r"\1", re.sub(r"\s+", " ", text)).strip()


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


def test_embeddingModelId_equalsTheBackendConstant() -> None:
    backend = ast.literal_eval(_assignments(_EMBEDDINGS)["EMBEDDING_MODEL_ID"])

    assert backend == rules.EMBEDDING_MODEL_ID


def test_dockerfileEmbedArgs_composeTheModelId() -> None:
    dockerfile = _DOCKERFILE.read_text(encoding="utf-8")
    args = dict(re.findall(r"^ARG (EMBED_\w+)=(\S+)$", dockerfile, re.MULTILINE))

    assert f"{args['EMBED_MODEL']}@{args['EMBED_REVISION']}+int8" == rules.EMBEDDING_MODEL_ID
    assert 'echo "${EMBED_MODEL}@${EMBED_REVISION}+int8" > /models/embed/model_id.txt' in dockerfile


def test_embedParityScript_holdsTheNames_failsBelowTheMinimum() -> None:
    # Loaded from its path: the script imports the ML packages only in `main`.
    spec = importlib.util.spec_from_file_location("check_embed_parity", _EMBED_PARITY)
    assert spec and spec.loader
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    close = [[1.0, 0.0], [0.0, 1.0]]
    drifted = [[1.0, 0.0], [0.2, 0.98]]

    assert len(set(script.PARITY_NAMES)) == len(script.PARITY_NAMES) == 20
    assert script.MIN_COSINE == 0.99
    assert script.gate(close, close) == 0
    assert script.gate(close, drifted) == 1


def test_visibility_isTheBackendParityTestsCallSiteRule() -> None:
    call = _assignments(_PARITY)["CALL_SITE_RULE"]
    assert isinstance(call, ast.Call) and len(call.args) == 1
    rule = ast.literal_eval(call.args[0])
    assert _CALL_SITE_PREFIX.match(rule)

    expected = _CALL_SITE_PREFIX.sub("", rule).replace(":seeker", "w.seeker_party_id")

    assert _sql(statements._VISIBILITY) == _sql(expected)
