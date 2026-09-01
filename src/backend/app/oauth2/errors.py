"""`OAuth2Error` enum, `OAuth2ErrorResponse` model, and the single
consolidated error-code → HTTP-status mapper for all OAuth2 endpoints
(register, authorize, token, introspect). Per spec.md's "Uniform OAuth2
error shape": `error_uri` is never present in the response body — not
`null`, actually absent from the JSON — so the model simply never declares
that field (nothing to omit at serialization time).

The status mapper consolidates what were 4 verbatim-duplicated Java switch
statements (`OAuth2TokenFilter`, `OAuth2AuthorizationFilter`,
`OAuth2IntrospectionFilter`, `PublicClientRegistrationFilter`) into one
function — safe, behavior-preserving cleanup since all 4 copies were
identical (per spec.md's explicit note).
"""

from __future__ import annotations

import enum

from fastapi.responses import JSONResponse
from pydantic import BaseModel


class OAuth2Error(enum.StrEnum):
    INVALID_REQUEST = "invalid_request"
    INVALID_CLIENT = "invalid_client"
    INVALID_GRANT = "invalid_grant"
    UNAUTHORIZED_CLIENT = "unauthorized_client"
    ACCESS_DENIED = "access_denied"
    UNSUPPORTED_RESPONSE_TYPE = "unsupported_response_type"
    INVALID_SCOPE = "invalid_scope"
    SERVER_ERROR = "server_error"
    INVALID_CLIENT_METADATA = "invalid_client_metadata"
    UNSUPPORTED_GRANT_TYPE = "unsupported_grant_type"


class OAuth2ErrorResponse(BaseModel):
    """Field order (`error`, `error_description`) is preserved by
    `model_dump`/JSON serialization. No `error_uri` field — see module
    docstring."""

    error: str
    error_description: str


_STATUS_BY_ERROR: dict[OAuth2Error, int] = {
    OAuth2Error.INVALID_CLIENT: 401,
    OAuth2Error.UNAUTHORIZED_CLIENT: 403,
    OAuth2Error.ACCESS_DENIED: 403,
    OAuth2Error.SERVER_ERROR: 500,
}


def oauth2_error_status(error: OAuth2Error) -> int:
    """`invalid_client` -> 401; `unauthorized_client`/`access_denied` -> 403;
    `server_error` -> 500; everything else (`invalid_request`,
    `invalid_scope`, `unsupported_response_type`, `invalid_grant`,
    `unsupported_grant_type`, `invalid_client_metadata`) -> 400."""
    return _STATUS_BY_ERROR.get(error, 400)


def oauth2_error_json(error: OAuth2Error, description: str) -> JSONResponse:
    """Builds the uniform OAuth2 error envelope at the status this
    `error` code maps to."""
    body = OAuth2ErrorResponse(error=error.value, error_description=description)
    return JSONResponse(status_code=oauth2_error_status(error), content=body.model_dump())
