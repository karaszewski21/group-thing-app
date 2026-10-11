"""Read side of organization media: the public `/public/{slug}` payload
(newest APPROVED logo/cover, APPROVED gallery, CDN URLs, 2 statements), the
owner's `/mine` list (non-superseded rows, signed URLs for unapproved ones)
and the `/{slug}` HTML preview, which reads only the newest APPROVED cover
for its `og:image`, in one statement."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.auth.models import User
from app.moderation.status import ModerationStatus
from app.organizations.models import MediaKind, OrganizationMedia
from tests.conftest import count_queries

_BASE_TIME = datetime(2026, 1, 1, 12, 0, 0)


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_organization(client: AsyncClient, email: str, name: str) -> tuple[str, dict]:
    token = await _register_organizer(client, email)
    created = await client.post(
        "/api/organizations/mine", json={"name": name}, headers=_auth_headers(token)
    )
    assert created.status_code == 201
    return token, created.json()


async def _uploader_id(db_session: AsyncSession) -> uuid.UUID:
    user = User(username=f"orgmedia-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    return user.id


async def create_and_save_media(
    db_session: AsyncSession,
    organization_id: str,
    uploader_id: uuid.UUID,
    kind: MediaKind,
    status: ModerationStatus,
    *,
    minutes: int,
    sort_order: int = 0,
) -> OrganizationMedia:
    media = OrganizationMedia(
        organization_id=uuid.UUID(organization_id),
        kind=kind,
        storage_key=f"organizations/{organization_id}/{uuid.uuid4()}",
        size_bytes=1000,
        content_sha256=uuid.uuid4().hex * 2,
        status=status,
        sort_order=sort_order,
        uploaded_by_user_id=uploader_id,
        created_at=_BASE_TIME + timedelta(minutes=minutes),
    )
    db_session.add(media)
    await db_session.flush()
    return media


def _public(media: OrganizationMedia) -> dict[str, str]:
    return {
        "url": f"https://cdn.test/{media.large_key}",
        "thumb_url": f"https://cdn.test/{media.thumb_key}",
    }


async def _full_media(
    db_session: AsyncSession, organization_id: str
) -> dict[str, OrganizationMedia]:
    uploader = await _uploader_id(db_session)
    approved, pending = ModerationStatus.APPROVED, ModerationStatus.PENDING
    return {
        "old_logo": await create_and_save_media(
            db_session, organization_id, uploader, MediaKind.LOGO, approved, minutes=1
        ),
        "new_logo": await create_and_save_media(
            db_session, organization_id, uploader, MediaKind.LOGO, approved, minutes=2
        ),
        "cover": await create_and_save_media(
            db_session, organization_id, uploader, MediaKind.COVER, approved, minutes=3
        ),
        "pending_cover": await create_and_save_media(
            db_session, organization_id, uploader, MediaKind.COVER, pending, minutes=4
        ),
        "gallery_second": await create_and_save_media(
            db_session,
            organization_id,
            uploader,
            MediaKind.GALLERY,
            approved,
            minutes=5,
            sort_order=1,
        ),
        "gallery_first": await create_and_save_media(
            db_session,
            organization_id,
            uploader,
            MediaKind.GALLERY,
            approved,
            minutes=6,
            sort_order=0,
        ),
        "gallery_third": await create_and_save_media(
            db_session,
            organization_id,
            uploader,
            MediaKind.GALLERY,
            approved,
            minutes=7,
            sort_order=2,
        ),
    }


async def test_publicRead_onlyApprovedNewestPerSlot_orderedGallery_cdnUrls(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, organization = await _create_organization(client, "media.public1@example.com", "Media A")
    org_id = organization["id"]
    uploader = await _uploader_id(db_session)
    approved = ModerationStatus.APPROVED
    await create_and_save_media(db_session, org_id, uploader, MediaKind.LOGO, approved, minutes=1)
    newest_logo = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, approved, minutes=2
    )
    await create_and_save_media(
        db_session, org_id, uploader, MediaKind.COVER, ModerationStatus.PENDING, minutes=3
    )
    await create_and_save_media(
        db_session, org_id, uploader, MediaKind.GALLERY, ModerationStatus.REJECTED, minutes=4
    )
    second = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.GALLERY, approved, minutes=5, sort_order=1
    )
    first = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.GALLERY, approved, minutes=6, sort_order=0
    )

    response = await client.get(f"/api/organizations/public/{organization['slug']}")

    assert response.status_code == 200
    body = response.json()
    assert body["logo"] == _public(newest_logo)
    assert body["cover"] is None
    assert body["gallery"] == [_public(first), _public(second)]


async def test_publicRead_statementCount_isTwo_forZeroAndFullMedia(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    _, empty = await _create_organization(client, "media.count1@example.com", "Media Pusta")
    _, full = await _create_organization(client, "media.count2@example.com", "Media Pełna")
    await _full_media(db_session, full["id"])

    with count_queries(engine) as empty_statements:
        empty_response = await client.get(f"/api/organizations/public/{empty['slug']}")
    with count_queries(engine) as full_statements:
        full_response = await client.get(f"/api/organizations/public/{full['slug']}")

    assert empty_response.status_code == 200
    assert empty_response.json()["gallery"] == []
    assert full_response.status_code == 200
    assert len(full_response.json()["gallery"]) == 3
    assert len(empty_statements) == 2
    assert len(full_statements) == 2


async def test_publicRead_storageNone_returnsEmptyMedia_oneStatement(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    _, organization = await _create_organization(client, "media.nostore1@example.com", "Media B")
    await _full_media(db_session, organization["id"])
    app.dependency_overrides[get_storage] = lambda: None

    with count_queries(engine) as statements:
        response = await client.get(f"/api/organizations/public/{organization['slug']}")

    assert response.status_code == 200
    body = response.json()
    assert (body["logo"], body["cover"], body["gallery"]) == (None, None, [])
    assert len(statements) == 1


async def test_mine_listsPendingAndRejectedWithSignedUrls_excludesSuperseded(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, organization = await _create_organization(client, "media.mine1@example.com", "Media C")
    org_id = organization["id"]
    uploader = await _uploader_id(db_session)
    status = ModerationStatus
    # Superseded by the newer APPROVED logo: hidden.
    await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, status.REJECTED, minutes=1
    )
    await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, status.APPROVED, minutes=2
    )
    logo = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, status.APPROVED, minutes=3
    )
    rejected_one = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, status.REJECTED, minutes=4
    )
    rejected_two = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.LOGO, status.REJECTED, minutes=5
    )
    pending_cover = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.COVER, status.NEEDS_REVIEW, minutes=6
    )
    gallery_rejected = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.GALLERY, status.REJECTED, minutes=7, sort_order=1
    )
    gallery_approved = await create_and_save_media(
        db_session, org_id, uploader, MediaKind.GALLERY, status.APPROVED, minutes=8, sort_order=0
    )

    response = await client.get("/api/organizations/mine", headers=_auth_headers(token))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == org_id
    assert body["slug"] == organization["slug"]
    media = body["media"]
    assert [item["id"] for item in media] == [
        str(row.id)
        for row in (
            logo,
            rejected_one,
            rejected_two,
            pending_cover,
            gallery_approved,
            gallery_rejected,
        )
    ]
    assert media[0] == {
        "id": str(logo.id),
        "kind": "LOGO",
        "status": "APPROVED",
        "url": f"https://cdn.test/{logo.large_key}",
        "thumb_url": f"https://cdn.test/{logo.thumb_key}",
        "sort_order": 0,
    }
    assert media[3]["status"] == "NEEDS_REVIEW"
    assert media[3]["url"] == f"https://origin.test/{pending_cover.large_key}?signed"
    assert media[3]["thumb_url"] == f"https://origin.test/{pending_cover.thumb_key}?signed"
    assert media[5]["url"] == f"https://origin.test/{gallery_rejected.large_key}?signed"


async def test_mine_storageNone_returnsEmptyMedia(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.main import app
    from app.storage.service import get_storage

    token, organization = await _create_organization(client, "media.mine2@example.com", "Media D")
    await _full_media(db_session, organization["id"])
    app.dependency_overrides[get_storage] = lambda: None

    response = await client.get("/api/organizations/mine", headers=_auth_headers(token))

    assert response.status_code == 200
    assert response.json()["media"] == []
    assert response.json()["name"] == "Media D"


async def test_slugPreview_newestApprovedCover_isOgImage_oneMediaQuery(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    _, organization = await _create_organization(client, "media.preview1@example.com", "Media E")
    rows = await _full_media(db_session, organization["id"])

    with count_queries(engine) as statements:
        response = await client.get(f"/{organization['slug']}")

    assert response.status_code == 200
    cover_url = _public(rows["cover"])["url"]
    assert '<meta property="og:title" content="Media E">' in response.text
    assert f'<meta property="og:image" content="{cover_url}">' in response.text
    assert '<meta name="twitter:card" content="summary_large_image">' in response.text
    assert len([statement for statement in statements if "organization_media" in statement]) == 1


async def test_slugPreview_noApprovedCover_hasNoOgImage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, organization = await _create_organization(client, "media.preview2@example.com", "Media F")
    uploader = await _uploader_id(db_session)
    await create_and_save_media(
        db_session,
        organization["id"],
        uploader,
        MediaKind.COVER,
        ModerationStatus.PENDING,
        minutes=1,
    )

    response = await client.get(f"/{organization['slug']}")

    assert response.status_code == 200
    assert "og:image" not in response.text
    assert '<meta name="twitter:card" content="summary">' in response.text
