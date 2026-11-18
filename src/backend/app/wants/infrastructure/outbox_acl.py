"""Anti-corruption layer over `app.outbox`: the ONLY `app.wants` module that
imports the outbox vertical. It must not import `..schemas`."""

from __future__ import annotations

from app.outbox.registry import Handler, get_handlers, register_handler

__all__ = ["Handler", "get_handlers", "register_handler"]
