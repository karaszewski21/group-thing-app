"""Only `matcher/clock.py` reads the host clock (mirrors the backend's
`tests/test_domain_clock_guard.py`)."""

from pathlib import Path

_PACKAGE = Path(__file__).resolve().parents[1] / "matcher"
_CLOCK = _PACKAGE / "clock.py"
_FORBIDDEN = ("datetime.now(", "datetime.utcnow(", "date.today(")


def test_matcherPackage_onlyClockModuleReadsTheClock() -> None:
    offenders = [
        f"{path.relative_to(_PACKAGE)}: {needle}"
        for path in sorted(_PACKAGE.rglob("*.py"))
        if path != _CLOCK
        for needle in _FORBIDDEN
        if needle in path.read_text(encoding="utf-8")
    ]

    assert offenders == []


def test_utcnow_returnsNaiveUtc() -> None:
    from matcher import clock

    assert clock.utcnow().tzinfo is None
