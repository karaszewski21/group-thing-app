"""Footprint-domain exception hierarchy.

Direct port of the Java `FootprintCalculationException` abstract sealed interface and its
5 typed subtypes. `app/footprint/errors.py` (Group 12) maps these to RFC7807 `ProblemDetail`
responses via `code`/`details`; this module stays framework-agnostic.

**Not** part of this hierarchy (preserve exactly, do not "fix"): `BreakdownScaler`'s PER_100G
validation failure raises a plain `ValueError` instead of `InvalidParametersException` — a
known, deliberately-preserved bug that must surface via the legacy error envelope, not
problem+json. See `app/footprint/engine/breakdown_scaler.py`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any


class FootprintCalculationException(ABC, Exception):
    """Base for the 5 typed footprint-domain exceptions."""

    def __init__(self, message: str) -> None:
        super().__init__(message)

    @property
    @abstractmethod
    def code(self) -> str: ...

    @property
    @abstractmethod
    def details(self) -> dict[str, Any]: ...


class MissingFactorException(FootprintCalculationException):
    """Raised in STRICT mode when no emission factor covers `as_of` for a component."""

    def __init__(self, component_id: str, timestamp: datetime) -> None:
        self.component_id = component_id
        self.timestamp = timestamp
        super().__init__(f"No factor found for component {component_id} at {timestamp}")

    @property
    def code(self) -> str:
        return "MISSING_FACTOR"

    @property
    def details(self) -> dict[str, Any]:
        return {"componentId": self.component_id, "timestamp": self.timestamp}


class MissingProductAttributeException(FootprintCalculationException):
    """Raised when a product has no stored attributes to merge with the request."""

    def __init__(self, product_id: str, attribute: str) -> None:
        self.product_id = product_id
        self.attribute = attribute
        super().__init__(f"Missing attribute '{attribute}' on product {product_id}")

    @property
    def code(self) -> str:
        return "MISSING_PRODUCT_ATTRIBUTE"

    @property
    def details(self) -> dict[str, Any]:
        return {"productId": self.product_id, "attribute": self.attribute}


class InvalidParametersException(FootprintCalculationException):
    """Raised for a structurally invalid request parameter (e.g. a bad enum value)."""

    def __init__(self, parameter: str, value: Any) -> None:
        self.parameter = parameter
        self.value = value
        super().__init__(f"Invalid parameter '{parameter}': {value}")

    @property
    def code(self) -> str:
        return "INVALID_PARAMETERS"

    @property
    def details(self) -> dict[str, Any]:
        return {"parameter": self.parameter, "value": self.value}


class ApplicabilityResolutionException(FootprintCalculationException):
    """Raised when a component's applicability cannot be resolved for the context."""

    def __init__(self, component_id: str, reason: str) -> None:
        self.component_id = component_id
        self.reason = reason
        super().__init__(f"Applicability resolution failed for {component_id}: {reason}")

    @property
    def code(self) -> str:
        return "APPLICABILITY_RESOLUTION_FAILED"

    @property
    def details(self) -> dict[str, Any]:
        return {"componentId": self.component_id, "reason": self.reason}


class FactorVersionOverlapException(FootprintCalculationException):
    """Raised when two validity windows for the same component overlap."""

    def __init__(self, component_id: str, a: str, b: str) -> None:
        self.component_id = component_id
        self.a = a
        self.b = b
        super().__init__(f"Factor versions overlap for component {component_id}")

    @property
    def code(self) -> str:
        return "FACTOR_VERSION_OVERLAP"

    @property
    def details(self) -> dict[str, Any]:
        return {"componentId": self.component_id, "a": self.a, "b": self.b}
