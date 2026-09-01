"""`POST /oauth2/register` (dynamic client registration), `POST
/oauth2/authorize` (authorization-code issuance), `POST /oauth2/token`
(all 3 grants), and `POST /oauth2/introspect`.

Every route here follows spec.md's Auth/OAuth2 Spec "OAuth2 authorization
server — endpoint-by-endpoint" section verbatim, including exact validation
messages, exact validation order, exact response field order, and the exact
substring-matching order used to map an `/oauth2/authorize` failure message
to an OAuth2 error code.
"""

from __future__ import annotations

import base64
import hashlib
import re
import time
import uuid
from datetime import datetime
from typing import Annotated, Any

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal, require_any
from app.core.security import decode_base64_hmac_key, decode_token, hash_password, verify_password
from app.db import get_db

from .client_auth import OAuth2ClientAuthenticator
from .errors import OAuth2Error, oauth2_error_json
from .metadata_router import resolve_base_url
from .models import RegisteredClient
from .stores import (
    AuthorizationCodeEntry,
    RefreshTokenEntry,
    authorization_code_store,
    refresh_token_store,
)

router = APIRouter(tags=["oauth2"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

ALLOWED_SCOPES: tuple[str, ...] = ("mcp:read", "mcp:edit")
_ALLOWED_SCOPES_DISPLAY = "[" + ", ".join(ALLOWED_SCOPES) + "]"

_ALLOWED_AUTH_METHODS = ("client_secret_post", "client_secret_basic", "none")
_ALLOWED_GRANT_TYPES = ("authorization_code", "refresh_token")
_LOOPBACK_PREFIXES = ("http://localhost", "http://127.0.0.1", "http://[::1]")

_CODE_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


# --- POST /oauth2/register (DCR) -------------------------------------------


class ClientRegistrationRequest(BaseModel):
    """All fields optional at the wire level — validation (with spec.md's
    exact messages) happens explicitly in the handler, not via Pydantic's
    own 422 machinery, since the required/default/conditional rules don't
    map onto plain field constraints."""

    client_name: str | None = None
    redirect_uris: list[str] | None = None
    token_endpoint_auth_method: str | None = None
    grant_types: list[str] | None = None
    scope: str | None = None
    response_types: list[str] | None = Field(default=None)


class _RegistrationError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _validate_client_name(client_name: str | None) -> str:
    if client_name is None or not client_name.strip():
        raise _RegistrationError("client_name is required and cannot be empty")
    if len(client_name) > 255:
        raise _RegistrationError("client_name cannot exceed 255 characters")
    return client_name


def _validate_grant_types(grant_types: list[str] | None) -> list[str]:
    resolved = list(grant_types) if grant_types else ["authorization_code"]
    for grant_type in resolved:
        if grant_type not in _ALLOWED_GRANT_TYPES:
            raise _RegistrationError(f"Unsupported grant type: {grant_type}")
    return resolved


def _validate_redirect_uris(redirect_uris: list[str] | None, grant_types: list[str]) -> list[str]:
    if "authorization_code" not in grant_types:
        return list(redirect_uris) if redirect_uris else []

    if not redirect_uris:
        raise _RegistrationError(
            "redirect_uris is required when using authorization_code grant type"
        )
    for uri in redirect_uris:
        if not uri or not uri.strip():
            raise _RegistrationError("redirect_uris cannot contain empty values")
    for uri in redirect_uris:
        if not (uri.startswith("https://") or uri.startswith(_LOOPBACK_PREFIXES)):
            raise _RegistrationError(f"redirect_uri must be a valid HTTPS URL: {uri}")
    for uri in redirect_uris:
        if "#" in uri:
            raise _RegistrationError(f"redirect_uri cannot contain fragments: {uri}")
    return list(redirect_uris)


def _validate_scope(scope: str | None) -> list[str]:
    if scope is None:
        return list(ALLOWED_SCOPES)
    for token in scope.split():
        if token not in ALLOWED_SCOPES:
            raise _RegistrationError(
                f"Unsupported scope: {token}. Allowed scopes: {_ALLOWED_SCOPES_DISPLAY}"
            )
    return scope.split()


def _validate_auth_method(auth_method: str | None) -> str:
    resolved = auth_method if auth_method is not None else "client_secret_post"
    if resolved not in _ALLOWED_AUTH_METHODS:
        raise _RegistrationError(
            "token_endpoint_auth_method must be 'client_secret_post', "
            "'client_secret_basic', or 'none'"
        )
    return resolved


@router.post("/oauth2/register", status_code=201, response_model=None)
async def register_client(body: ClientRegistrationRequest, db: DbSession) -> Response:
    # Order: client_name (independent) -> grant_types (needed by the
    # redirect_uris conditional-required check that follows it) ->
    # redirect_uris -> scope -> token_endpoint_auth_method. spec.md doesn't
    # prescribe a cross-field validation order for DCR (unlike /authorize's
    # explicit 7-step order) since every failure maps to the same
    # `invalid_client_metadata` code regardless of which check tripped;
    # this order is chosen only to satisfy the redirect_uris/grant_types
    # dependency.
    try:
        client_name = _validate_client_name(body.client_name)
        grant_types = _validate_grant_types(body.grant_types)
        redirect_uris = _validate_redirect_uris(body.redirect_uris, grant_types)
        scopes = _validate_scope(body.scope)
        auth_method = _validate_auth_method(body.token_endpoint_auth_method)
    except _RegistrationError as exc:
        return oauth2_error_json(OAuth2Error.INVALID_CLIENT_METADATA, exc.message)

    client_id = str(uuid.uuid4())
    plaintext_secret = str(uuid.uuid4())
    issued_at = datetime.utcnow()

    client = RegisteredClient(
        id=uuid.uuid4(),
        client_id=client_id,
        client_id_issued_at=issued_at,
        client_secret=hash_password(plaintext_secret),
        client_secret_expires_at=None,
        client_name=client_name,
        client_authentication_methods=[auth_method],
        authorization_grant_types=grant_types,
        redirect_uris=redirect_uris,
        scopes=scopes,
    )
    db.add(client)
    await db.commit()

    # Plain dict (not a pydantic model) so insertion order is preserved
    # verbatim in the JSON response, matching spec.md's exact field order.
    response_body = {
        "client_id": client_id,
        "client_secret": plaintext_secret,
        "client_name": client_name,
        "client_id_issued_at": int(issued_at.timestamp()),
        "redirect_uris": redirect_uris,
        "grant_types": grant_types,
        "response_types": ["code"],
        "scope": " ".join(scopes),
        "token_endpoint_auth_method": auth_method,
        "client_secret_expires_at": 0,
    }
    return JSONResponse(status_code=201, content=response_body)


# --- POST /oauth2/authorize -------------------------------------------------


class AuthorizeValidationError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def validate_authorize_request(
    *,
    client_id: str | None,
    redirect_uri: str | None,
    response_type: str | None,
    scope: str | None,
    code_challenge: str | None,
    code_challenge_method: str | None,
    client: RegisteredClient | None,
    authenticated: bool,
) -> None:
    """Raises `AuthorizeValidationError` on the first failure, walking
    spec.md's exact 7-step validation order. Kept as a pure function
    (independent of the FastAPI request/auth machinery) so each step —
    including step 7 — is directly unit-testable, even though the actual
    route below gates authentication earlier via `Depends(require_any())`
    (see the route's docstring for why step 7 is unreachable there)."""
    if not client_id or not redirect_uri or not response_type:
        raise AuthorizeValidationError(
            "Missing required parameters: client_id, redirect_uri, response_type"
        )

    if response_type != "code":
        raise AuthorizeValidationError("Unsupported response_type. Only 'code' is supported")

    if client is None:
        raise AuthorizeValidationError("Invalid client_id")

    registered_redirect_uris = client.redirect_uris or []
    if redirect_uri not in registered_redirect_uris:
        raise AuthorizeValidationError("redirect_uri not registered for this client")

    requested_scopes = scope.split() if scope else []
    client_scopes = set(client.scopes or [])
    for requested in requested_scopes:
        if requested not in client_scopes:
            raise AuthorizeValidationError(f"Scope not allowed for this client: {requested}")

    is_public_client = "none" in (client.client_authentication_methods or [])
    if is_public_client:
        if not code_challenge and not code_challenge_method:
            raise AuthorizeValidationError(
                "PKCE is required for public clients. Provide code_challenge "
                "and code_challenge_method parameters"
            )
        if bool(code_challenge) != bool(code_challenge_method):
            raise AuthorizeValidationError(
                "Both code_challenge and code_challenge_method must be provided when using PKCE"
            )
        if code_challenge_method != "S256":
            raise AuthorizeValidationError(
                "Unsupported code_challenge_method. Only 'S256' is supported"
            )
        assert code_challenge is not None  # narrowed by the checks above
        if not (43 <= len(code_challenge) <= 128):
            raise AuthorizeValidationError(
                "Invalid code_challenge length. Must be 43-128 characters"
            )
        if not _CODE_CHALLENGE_RE.match(code_challenge):
            raise AuthorizeValidationError(
                "Invalid code_challenge format. Must be base64url-encoded"
            )

    if not authenticated:
        raise AuthorizeValidationError("User must be authenticated")


def map_authorize_error(message: str) -> OAuth2Error:
    """Substring match, evaluated in spec.md's exact order — first match
    wins. Note the ordering consequence spec.md calls out: "redirect_uri not
    registered for this client" matches the first branch (`invalid_request`)
    even though it also loosely relates to client validation; and the
    "Missing required parameters: client_id, redirect_uri, response_type"
    message itself contains "redirect_uri" as a substring, so it too matches
    the first branch (same `invalid_request` result either way)."""
    if "redirect_uri" in message:
        return OAuth2Error.INVALID_REQUEST
    if "Scope not allowed" in message or "scope" in message:
        return OAuth2Error.INVALID_SCOPE
    if "response_type" in message:
        return OAuth2Error.UNSUPPORTED_RESPONSE_TYPE
    if "client_id" in message:
        return OAuth2Error.INVALID_REQUEST
    if "PKCE" in message:
        return OAuth2Error.INVALID_REQUEST
    if "authenticated" in message:
        return OAuth2Error.UNAUTHORIZED_CLIENT
    return OAuth2Error.INVALID_REQUEST


async def _form_or_query_param(request: Request, form: dict[str, str], name: str) -> str | None:
    value = form.get(name)
    if value:
        return value
    query_value = request.query_params.get(name)
    return query_value if query_value else None


async def _read_params(request: Request) -> dict[str, str]:
    """Mirrors `auth_deps._extract_token`'s defensive form-parsing: only
    attempts `request.form()` when the content-type says form, and degrades
    to "no form params" rather than 500ing if the multipart parser isn't
    available for some reason."""
    content_type = request.headers.get("content-type", "")
    if "form" not in content_type:
        return {}
    try:
        form = await request.form()
    except AssertionError:
        return {}
    return {key: value for key, value in form.items() if isinstance(value, str)}


@router.post("/oauth2/authorize", response_model=None)
async def authorize(
    request: Request,
    principal: Annotated[Principal, Depends(require_any())],
    db: DbSession,
) -> Response:
    """Requires prior JWT authentication — gated here via
    `Depends(require_any())` (zero-arg: "just authenticated", row 25's
    catch-all), matching Group 4's resolution that this endpoint is *not*
    in the permitAll matrix despite not being under `/api/`. Because that
    dependency already 401s (generic legacy envelope, not the OAuth2 shape)
    before this handler body ever runs, `validate_authorize_request`'s step
    7 ("User must be authenticated" -> `unauthorized_client`) can never
    actually fire through this route — `principal` is guaranteed non-`None`
    here. It's preserved in the pure validation function anyway for
    fidelity to spec.md's 7-step order and so it stays directly testable;
    this mirrors the project's existing pattern of documenting
    preserved-but-unreachable code paths (e.g. Group 10's
    `FactorVersionOverlapException`, Group 4's row-10 matrix note).
    """
    form = await _read_params(request)

    client_id = await _form_or_query_param(request, form, "client_id")
    redirect_uri = await _form_or_query_param(request, form, "redirect_uri")
    response_type = await _form_or_query_param(request, form, "response_type")
    scope = await _form_or_query_param(request, form, "scope")
    state = await _form_or_query_param(request, form, "state")
    code_challenge = await _form_or_query_param(request, form, "code_challenge")
    code_challenge_method = await _form_or_query_param(request, form, "code_challenge_method")

    client: RegisteredClient | None = None
    if client_id:
        client_query = select(RegisteredClient).where(RegisteredClient.client_id == client_id)
        client = (await db.execute(client_query)).scalar_one_or_none()

    try:
        validate_authorize_request(
            client_id=client_id,
            redirect_uri=redirect_uri,
            response_type=response_type,
            scope=scope,
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
            client=client,
            authenticated=True,  # guaranteed by Depends(require_any()) above
        )
    except AuthorizeValidationError as exc:
        return oauth2_error_json(map_authorize_error(exc.message), exc.message)

    # Past validation: client_id/redirect_uri/response_type are non-empty,
    # and client is a resolved RegisteredClient.
    assert client_id is not None
    assert redirect_uri is not None

    code = authorization_code_store.generate_code()
    stripped_permissions = tuple(
        sorted(authority.removeprefix("PERMISSION_") for authority in principal.authorities)
    )
    entry = AuthorizationCodeEntry(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope or "",
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        username=principal.username,
        permissions=stripped_permissions,
    )
    await authorization_code_store.put(code, entry)

    separator = "&" if "?" in redirect_uri else "?"
    location = f"{redirect_uri}{separator}code={code}"
    if state:
        location += f"&state={state}"
    return RedirectResponse(url=location, status_code=302)


# --- POST /oauth2/token ------------------------------------------------------

_TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange"
_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

# 15 minutes. Deliberately its own constant, independent of
# `settings.jwt_expiration_ms` (that env var governs the standard login
# token's lifetime; OAuth2-issued tokens always live 15 minutes, hardcoded).
_OAUTH2_TOKEN_EXPIRATION_MS = 900_000

# The `expires_in` response-body literal. Kept as its own constant, separate
# from `_OAUTH2_TOKEN_EXPIRATION_MS` above, even though they currently agree
# numerically (900_000 ms == 900 s) — per spec.md, do not silently derive
# one from the other, since the source doesn't.
_TOKEN_RESPONSE_EXPIRES_IN = 900

# Generic `invalid_grant` message shared by every authorization_code-grant
# failure mode from "code invalid/expired" through "PKCE verification
# failed" — spec.md requires these to be indistinguishable in the response
# (never leak which check tripped).
_INVALID_GRANT_CODE_MESSAGE = "Authorization code is invalid or has expired"

_INVALID_GRANT_REFRESH_MESSAGE = "The provided refresh token is invalid, expired, or revoked"

# Fixed RFC 8693 scope-mapping table for the token-exchange grant. Order is
# significant only insofar as Python dicts preserve insertion order, which
# is irrelevant here since lookups are by key — the *output* order that
# must be preserved is the order of the *source* scopes/permissions being
# mapped, not this table's own order.
_TOKEN_EXCHANGE_SCOPE_MAP: dict[str, str] = {"mcp:read": "READ", "mcp:edit": "EDIT"}


async def _read_form(request: Request) -> dict[str, str]:
    """Same defensive form-parsing as `_read_params` above, reused here for
    `/oauth2/token` and `/oauth2/introspect` (both are standard
    `application/x-www-form-urlencoded` OAuth2 endpoints)."""
    try:
        form = await request.form()
    except AssertionError:
        return {}
    return {key: value for key, value in form.items() if isinstance(value, str)}


def _has_client_credentials(
    request: Request, body_client_id: str | None, body_client_secret: str | None
) -> bool:
    """Presence-only check (Basic header present, OR both body fields
    present) — mirrors `OAuth2ClientAuthenticator.authenticate`'s own
    presence logic exactly, without duplicating its verification. Needed
    because `authenticate()` returns `None` uniformly for "no credentials"
    and "wrong credentials" (see client_auth.py's docstring), but
    token-exchange/introspect must distinguish `"Client authentication
    required"` (no credentials at all) from `"Client authentication
    failed"` (credentials given but wrong)."""
    header = request.headers.get("Authorization")
    if header is not None and header.startswith("Basic "):
        return True
    return body_client_id is not None and body_client_secret is not None


def _encode_oauth2_token(
    *, issuer: str, subject: str, scopes: list[str], audience: str | None = None
) -> str:
    """Builds an OAuth2-issued JWT with claims in spec.md's exact order:
    `iss, sub, scopes, iat, exp[, aud]` (`aud` present only when an audience
    was passed — only the token-exchange grant passes one, self-audience).
    Note the claim name `scopes` (plural), distinct from the standard login
    token's `permissions` claim — both are read by the same
    `get_current_principal` fallback chain (`permissions` then `scopes`)."""
    issued_at = int(time.time())
    claims: dict[str, Any] = {
        "iss": issuer,
        "sub": subject,
        "scopes": list(scopes),
        "iat": issued_at,
        "exp": issued_at + _OAUTH2_TOKEN_EXPIRATION_MS // 1000,
    }
    if audience is not None:
        claims["aud"] = audience
    return jwt.encode(claims, key=decode_base64_hmac_key(settings.jwt_secret), algorithm="HS256")


def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    """`SHA256(code_verifier) == code_challenge`, base64url-encoded without
    padding — same encoding scheme as authorization-code generation."""
    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return computed == code_challenge


def _token_success_response(body: dict[str, Any]) -> JSONResponse:
    """Uniform success headers for all 3 `/oauth2/token` grants:
    `Cache-Control: no-store`, `Pragma: no-cache`."""
    response = JSONResponse(status_code=200, content=body)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


async def _authorization_code_grant(
    form: dict[str, str], db: AsyncSession, issuer: str
) -> Response:
    code = form.get("code")
    redirect_uri = form.get("redirect_uri")
    if not code:
        return oauth2_error_json(OAuth2Error.INVALID_REQUEST, "Missing required parameter: code")
    if not redirect_uri:
        return oauth2_error_json(
            OAuth2Error.INVALID_REQUEST, "Missing required parameter: redirect_uri"
        )

    entry = await authorization_code_store.consume(code)
    if entry is None:
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, _INVALID_GRANT_CODE_MESSAGE)

    request_client_id = form.get("client_id")
    if request_client_id and request_client_id != entry.client_id:
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, _INVALID_GRANT_CODE_MESSAGE)

    if redirect_uri != entry.redirect_uri:
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, _INVALID_GRANT_CODE_MESSAGE)

    client = (
        await db.execute(
            select(RegisteredClient).where(RegisteredClient.client_id == entry.client_id)
        )
    ).scalar_one_or_none()
    is_public_client = client is not None and "none" in (client.client_authentication_methods or [])
    if not is_public_client:
        client_secret = form.get("client_secret")
        if not client_secret:
            return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication required")
        if (
            client is None
            or client.client_secret is None
            or not verify_password(client_secret, client.client_secret)
        ):
            return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication failed")

    if entry.code_challenge:
        code_verifier = form.get("code_verifier")
        if not code_verifier or not _verify_pkce(code_verifier, entry.code_challenge):
            return oauth2_error_json(OAuth2Error.INVALID_GRANT, _INVALID_GRANT_CODE_MESSAGE)

    scopes = entry.scope.split() if entry.scope else []
    access_token = _encode_oauth2_token(issuer=issuer, subject=entry.username, scopes=scopes)
    new_refresh_token = await refresh_token_store.issue(
        client_id=entry.client_id, username=entry.username, scope=entry.scope
    )

    body: dict[str, Any] = {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": _TOKEN_RESPONSE_EXPIRES_IN,
        "refresh_token": new_refresh_token,
    }
    if entry.scope:
        body["scope"] = entry.scope
    return _token_success_response(body)


async def _refresh_token_grant(form: dict[str, str], issuer: str) -> Response:
    token_value = form.get("refresh_token")
    if not token_value:
        return oauth2_error_json(
            OAuth2Error.INVALID_REQUEST, "Missing required parameter: refresh_token"
        )

    entry: RefreshTokenEntry | None = await refresh_token_store.consume(token_value)
    if entry is None:
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, _INVALID_GRANT_REFRESH_MESSAGE)

    scopes = entry.scope.split() if entry.scope else []
    access_token = _encode_oauth2_token(issuer=issuer, subject=entry.username, scopes=scopes)
    new_refresh_token = await refresh_token_store.issue(
        client_id=entry.client_id, username=entry.username, scope=entry.scope
    )

    body: dict[str, Any] = {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": _TOKEN_RESPONSE_EXPIRES_IN,
        "refresh_token": new_refresh_token,
    }
    if entry.scope:
        body["scope"] = entry.scope
    return _token_success_response(body)


async def _token_exchange_grant(
    request: Request, form: dict[str, str], db: AsyncSession, issuer: str
) -> Response:
    body_client_id = form.get("client_id")
    body_client_secret = form.get("client_secret")
    if not _has_client_credentials(request, body_client_id, body_client_secret):
        return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication required")

    authenticator = OAuth2ClientAuthenticator(db)
    client = await authenticator.authenticate(request, body_client_id, body_client_secret)
    if client is None:
        return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication failed")

    subject_token = form.get("subject_token")
    if not subject_token:
        return oauth2_error_json(
            OAuth2Error.INVALID_REQUEST, "Missing required parameter: subject_token"
        )
    subject_token_type = form.get("subject_token_type")
    if not subject_token_type:
        return oauth2_error_json(
            OAuth2Error.INVALID_REQUEST, "Missing required parameter: subject_token_type"
        )
    if subject_token_type != _SUBJECT_TOKEN_TYPE:
        return oauth2_error_json(
            OAuth2Error.INVALID_REQUEST,
            f"Unsupported subject_token_type: {subject_token_type}",
        )

    try:
        claims = decode_token(subject_token, settings.jwt_secret)
    except jwt.PyJWTError:
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, "Subject token is invalid or expired")

    subject = claims.get("sub")
    if not isinstance(subject, str):
        return oauth2_error_json(OAuth2Error.INVALID_GRANT, "Subject token is invalid or expired")

    requested_scope = form.get("scope")
    if requested_scope:
        source_scopes: list[str] = requested_scope.split()
    else:
        source_scopes = claims.get("permissions") or claims.get("scopes") or []

    # Fixed mapping table, unmapped entries silently dropped, source order
    # preserved.
    mapped_scopes = [
        _TOKEN_EXCHANGE_SCOPE_MAP[scope]
        for scope in source_scopes
        if scope in _TOKEN_EXCHANGE_SCOPE_MAP
    ]

    access_token = _encode_oauth2_token(
        issuer=issuer, subject=subject, scopes=mapped_scopes, audience=issuer
    )

    body: dict[str, Any] = {
        "access_token": access_token,
        "issued_token_type": _SUBJECT_TOKEN_TYPE,
        "token_type": "Bearer",
        "expires_in": _TOKEN_RESPONSE_EXPIRES_IN,
    }
    return _token_success_response(body)


@router.post("/oauth2/token", response_model=None)
async def token(request: Request, db: DbSession) -> Response:
    """Dispatches on `grant_type` to one of the 3 supported grants. An
    unrecognized/missing `grant_type` is not explicitly specified by
    spec.md (which only documents the 3 known grants' internal behavior) —
    `unsupported_grant_type` is the natural fit among the existing
    `OAuth2Error` codes and is used here as a reasonable default."""
    form = await _read_form(request)
    issuer = resolve_base_url(request)
    grant_type = form.get("grant_type")

    if grant_type == "authorization_code":
        return await _authorization_code_grant(form, db, issuer)
    if grant_type == "refresh_token":
        return await _refresh_token_grant(form, issuer)
    if grant_type == _TOKEN_EXCHANGE_GRANT_TYPE:
        return await _token_exchange_grant(request, form, db, issuer)
    return oauth2_error_json(
        OAuth2Error.UNSUPPORTED_GRANT_TYPE, f"Unsupported grant_type: {grant_type}"
    )


# --- POST /oauth2/introspect -------------------------------------------------


@router.post("/oauth2/introspect", response_model=None)
async def introspect(request: Request, db: DbSession) -> Response:
    """RFC 7662. Requires OAuth2 client authentication (same dual Basic/
    body-credential path as the token-exchange grant). A missing or
    unparseable `token` is **not** an error — it's a valid `200
    {"active": false}` response per RFC 7662."""
    form = await _read_form(request)

    body_client_id = form.get("client_id")
    body_client_secret = form.get("client_secret")
    if not _has_client_credentials(request, body_client_id, body_client_secret):
        return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication required")

    authenticator = OAuth2ClientAuthenticator(db)
    client = await authenticator.authenticate(request, body_client_id, body_client_secret)
    if client is None:
        return oauth2_error_json(OAuth2Error.INVALID_CLIENT, "Client authentication failed")

    token_value = form.get("token")
    if not token_value:
        return JSONResponse(status_code=200, content={"active": False})

    try:
        claims = decode_token(token_value, settings.jwt_secret)
    except jwt.PyJWTError:
        return JSONResponse(status_code=200, content={"active": False})

    # Plain dict (not a pydantic model) so insertion order is preserved
    # verbatim, matching spec.md's exact key order.
    response_body: dict[str, Any] = {"active": True, "sub": claims.get("sub")}

    scopes_claim = claims.get("scopes")
    if scopes_claim:
        response_body["scope"] = " ".join(scopes_claim)

    response_body["exp"] = claims.get("exp")
    response_body["iat"] = claims.get("iat")

    if "iss" in claims:
        response_body["iss"] = claims["iss"]

    aud_claim = claims.get("aud")
    if aud_claim is not None:
        if isinstance(aud_claim, list):
            response_body["aud"] = aud_claim[0] if len(aud_claim) == 1 else aud_claim
        else:
            response_body["aud"] = aud_claim

    response_body["token_type"] = "Bearer"
    response_body["client_id"] = client.client_id

    return JSONResponse(status_code=200, content=response_body)
