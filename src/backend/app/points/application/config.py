"""The single `points_config` row of admin-tunable thresholds: the fresh
read used at award, close and job time, and the admin's compare-on-write."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException
from app.db import mapped_transaction_conflicts
from app.points.models import PointsConfig
from app.points.schemas import UpdatePointsConfigRequest

# (field, Polish label, lowest, highest) of every integer setting.
_INTEGER_FIELDS: tuple[tuple[str, str, int, int], ...] = (
    ("base_small", "Baza dla małych rzeczy", 1, 1000),
    ("base_medium", "Baza dla średnich rzeczy", 1, 1000),
    ("base_large", "Baza dla dużych rzeczy", 1, 1000),
    ("swap_award", "Punkty za wymianę", 0, 1000),
    ("wants_bonus", "Premia za rzecz z listy „Szukam”", 0, 1000),
    ("attendance_monthly_cap", "Limit miesięczny", 0, 10000),
    ("attendance_min_present", "Minimalna liczba obecnych", 1, 1000),
    ("attendance_auto_close_days", "Liczba dni do automatycznego zamknięcia", 1, 90),
    ("pair_reward_limit", "Limit nagród dla jednej pary", 0, 100),
    ("pair_window_days", "Okno limitu dla pary (dni)", 1, 365),
    ("max_points_offers", "Limit ofert za punkty", 0, 100),
    ("price_cap", "Cena maksymalna", 1, 1000),
    ("price_step", "Krok ceny", 1, 100),
)

_MULTIPLIER_FIELDS: tuple[tuple[str, str], ...] = (
    ("multiplier_new", "Nowy"),
    ("multiplier_like_new", "Jak nowy"),
    ("multiplier_good", "Dobry"),
    ("multiplier_fair", "Znośny"),
    ("multiplier_poor", "Słaby"),
)
_MULTIPLIER_MIN = Decimal("0.01")
_MULTIPLIER_MAX = Decimal("9.99")

# (field, lowest, highest, Polish message) of the POINTS price ratios.
_RATIO_FIELDS: tuple[tuple[str, Decimal, Decimal, str], ...] = (
    (
        "price_min_ratio",
        Decimal("0.01"),
        Decimal("1.00"),
        "Minimum ceny musi być liczbą od 0,01 do 1,00.",
    ),
    (
        "price_max_ratio",
        Decimal("1.00"),
        Decimal("3.00"),
        "Maksimum ceny musi być liczbą od 1,00 do 3,00.",
    ),
)
_TWO_DECIMALS = Decimal("0.01")
CAP_STEP_MESSAGE = "Cena maksymalna musi być wielokrotnością kroku ceny."

_MAX_LEVELS = 5
_LEVEL_MAX = 1000
LEVELS_MESSAGE = "Poziomy obecności muszą mieć od 1 do 5 różnych wartości od 0 do 1000."


class PointsConfigChangedException(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("Konfiguracja została zmieniona w międzyczasie. Odśwież stronę.")


async def load_config(db: AsyncSession) -> PointsConfig:
    """The seeded config row, read fresh on every use, so a change applies
    to the next award, close or job run."""
    return (await db.execute(select(PointsConfig))).scalar_one()


def _is_ratio(value: Decimal, lowest: Decimal, highest: Decimal) -> bool:
    """Finite, within the range and two decimal places at most: the columns
    are NUMERIC(4,2)."""
    return (
        value.is_finite() and lowest <= value <= highest and value == value.quantize(_TWO_DECIMALS)
    )


def _validate(body: UpdatePointsConfigRequest) -> list[int]:
    """Raises `ValueError` (400) with the first Polish message that applies;
    returns the attendance levels sorted ascending."""
    for field, label, lowest, highest in _INTEGER_FIELDS:
        value = getattr(body, field)
        if value < lowest:
            raise ValueError(f"{label} musi być liczbą całkowitą ≥ {lowest}.")
        if value > highest:
            raise ValueError(f"{label} musi być liczbą całkowitą ≤ {highest}.")
    for field, condition in _MULTIPLIER_FIELDS:
        if not _is_ratio(getattr(body, field), _MULTIPLIER_MIN, _MULTIPLIER_MAX):
            raise ValueError(f"Mnożnik dla stanu „{condition}” musi być liczbą od 0,01 do 9,99.")
    for field, ratio_min, ratio_max, message in _RATIO_FIELDS:
        if not _is_ratio(getattr(body, field), ratio_min, ratio_max):
            raise ValueError(message)
    if body.price_cap % body.price_step:
        raise ValueError(CAP_STEP_MESSAGE)
    levels = body.attendance_levels
    if not (
        1 <= len(levels) <= _MAX_LEVELS
        and len(set(levels)) == len(levels)
        and all(0 <= level <= _LEVEL_MAX for level in levels)
    ):
        raise ValueError(LEVELS_MESSAGE)
    return sorted(levels)


def _naive_utc(value: datetime) -> datetime:
    return value if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)


async def update_config(db: AsyncSession, body: UpdatePointsConfigRequest) -> PointsConfig:
    """A full replace guarded by the `updated_at` the admin read: a change
    saved in between is a 409, never overwritten. Changes apply only to
    later reads; stored values are never recomputed."""
    levels = _validate(body)
    async with mapped_transaction_conflicts(db):
        config = (await db.execute(select(PointsConfig).with_for_update())).scalar_one()
        if config.updated_at != _naive_utc(body.updated_at):
            await db.rollback()
            raise PointsConfigChangedException()
        for field, _label, _lowest, _highest in _INTEGER_FIELDS:
            setattr(config, field, getattr(body, field))
        for field, _condition in _MULTIPLIER_FIELDS:
            setattr(config, field, getattr(body, field))
        for field, _ratio_min, _ratio_max, _message in _RATIO_FIELDS:
            setattr(config, field, getattr(body, field))
        config.attendance_levels = levels
        await db.commit()
    await db.refresh(config)
    return config
