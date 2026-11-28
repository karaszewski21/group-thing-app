"""Keeps link tokens out of uvicorn's access log: the unsubscribe token in
`/api/email/unsubscribe/<token>` and any `token=`/`_token=` query value are
replaced by `[redacted]`. Access logging itself stays on."""

from __future__ import annotations

import logging
import re

_REDACTED = "[redacted]"
_UNSUBSCRIBE_PATH = re.compile(r"(/api/email/unsubscribe/)[^/?#\s\"]+")
_TOKEN_QUERY = re.compile(r"([?&]_?token=)[^&#\s\"]*")


def redact_tokens(text: str) -> str:
    text = _UNSUBSCRIBE_PATH.sub(rf"\g<1>{_REDACTED}", text)
    return _TOKEN_QUERY.sub(rf"\g<1>{_REDACTED}", text)


class TokenRedactingFilter(logging.Filter):
    """Rewrites the record's string arguments (uvicorn passes the path and
    query as one) and its message; never drops a record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_tokens(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        if isinstance(record.msg, str):
            record.msg = redact_tokens(record.msg)
        return True


def install_access_log_filter() -> None:
    """Adds the filter to `uvicorn.access` once; called at startup, after
    uvicorn has configured its loggers."""
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(existing, TokenRedactingFilter) for existing in access.filters):
        access.addFilter(TokenRedactingFilter())
