"""Rescales a breakdown tree to a different normalisation unit.

Direct port of the Java `internal.BreakdownScaler`.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import assert_never

from app.footprint.domain.breakdown import BreakdownNode, CompositeBreakdownNode, LeafBreakdownNode
from app.footprint.domain.enums import Normalisation
from app.footprint.engine.rounding_policy import RoundingPolicy

_ZERO = Decimal("0")
_PER_100G_NUMERATOR = Decimal("0.1")
_SCALE_FACTOR_PRECISION = 10


def _compute_scale_factor(material_weight_kg: Decimal) -> Decimal:
    """`Decimal("0.1") / material_weight_kg`, computed at 10-digit precision, ROUND_HALF_UP.

    Uses a local decimal context so this one division doesn't leak precision/rounding
    settings into unrelated arithmetic elsewhere in the process.
    """
    with localcontext() as ctx:
        ctx.prec = _SCALE_FACTOR_PRECISION
        ctx.rounding = ROUND_HALF_UP
        return _PER_100G_NUMERATOR / material_weight_kg


class BreakdownScaler:
    """Scales a breakdown tree to `TOTAL` (no-op) or `PER_100G` (per-100g-of-material)."""

    @staticmethod
    def scale(
        node: BreakdownNode,
        normalisation: Normalisation,
        material_weight_kg: Decimal | None,
    ) -> BreakdownNode:
        match normalisation:
            case Normalisation.TOTAL:
                return node
            case Normalisation.PER_100G:
                if material_weight_kg is None or material_weight_kg <= 0:
                    # Preserved bug (fixed decision #1, spec.md Error-Handling Spec): a
                    # plain ValueError, NOT one of the 5 typed FootprintCalculationException
                    # subtypes — must surface via the legacy error envelope, not problem+json.
                    raise ValueError(
                        "materialWeightKg must be positive for PER_100G normalisation"
                    )
                scale_factor = _compute_scale_factor(material_weight_kg)
                return BreakdownScaler._scale_node(node, scale_factor)
            case _:
                assert_never(normalisation)

    @staticmethod
    def _scale_node(node: BreakdownNode, scale_factor: Decimal) -> BreakdownNode:
        """Scales every leaf's kg_co2 by `scale_factor` first, then recomputes each
        composite's kg_co2 as the sum of its already-scaled children — never by scaling
        the composite's original total directly (rounding error accumulates per-leaf;
        this exact order of operations is load-bearing, not an optimization target).
        """
        match node:
            case LeafBreakdownNode():
                scaled = RoundingPolicy.round(node.kg_co2 * scale_factor)
                return replace(node, kg_co2=scaled)
            case CompositeBreakdownNode():
                scaled_children = [
                    BreakdownScaler._scale_node(child, scale_factor) for child in node.children
                ]
                total = RoundingPolicy.round(sum((c.kg_co2 for c in scaled_children), _ZERO))
                return replace(node, kg_co2=total, children=scaled_children)
            case _:
                assert_never(node)
