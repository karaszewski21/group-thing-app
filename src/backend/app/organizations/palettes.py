"""Allowlist of color palette presets (`Organization.palette_preset`).

Only the keys live here; the frontend owns the visuals (each preset's colors).
The default palette ("Mięta") has no key: it is the all-null theme
(`palette_preset`, `primary_color` and `accent_color` all NULL).

Keep `PALETTE_PRESET_KEYS` in sync with the frontend `PALETTE_PRESETS`; parity
is enforced by `organizerKeyParity.test.ts`, which parses the literal below by
regex — keep it a single `frozenset({...})` expression with double-quoted keys.
"""

from __future__ import annotations

PALETTE_PRESET_KEYS: frozenset[str] = frozenset(
    {
        "OCEAN",
        "LAVENDER",
        "RASPBERRY",
        "SUN",
        "FOREST",
        "TERRACOTTA",
        "GRAPHITE",
        "PLUM",
        "NORTH_SEA",
    }
)
