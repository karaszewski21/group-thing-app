"""Paid terms: the rules shared by every write path that sets a price and a
payment link (circle create/update, term create/update). The payment method
is always derived from the effective link, never read from a request. The
organizer's manual payment toggle lives in `attendance_points`, next to the
presence toggle."""

from __future__ import annotations

from decimal import Decimal

from ..models import PaymentMethod

PAYMENT_URL_REQUIRES_PRICE_MESSAGE = "Link wymaga ceny — wpisz cenę albo usuń link."


def ensure_payment_url_has_price(price: Decimal | None, url: str | None) -> None:
    """A link without a price in the effective (merged) state is a 400; the
    `ck_*_payment_url_requires_price` CHECKs back it up."""
    if url is not None and price is None:
        raise ValueError(PAYMENT_URL_REQUIRES_PRICE_MESSAGE)


def derive_payment_method(url: str | None) -> PaymentMethod | None:
    return PaymentMethod.EXTERNAL_LINK if url else None
