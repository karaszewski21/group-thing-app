"""`app.moderation`: the photos-only ADMIN review queue and decisions,
synchronous contact-info rules, and the outbox split between the API poller
and the worker. The worker routine itself is covered in
`test_moderation_worker`."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.authorization_matrix import resolve_requirement
from app.moderation import service as moderation_service
from app.moderation.events import PHOTO_MODERATION_REQUESTED, WORKER_EVENT_TYPES
from app.moderation.models import ModerationDecision, ModerationSource, ModerationSubjectType
from app.moderation.rules import CONTACT_INFO_MESSAGE, contains_contact_info
from app.moderation.status import ModerationStatus
from app.outbox import service as outbox_service
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus
from app.product.models import ProductPhoto
from tests.fake_storage import FakeStorage
from tests.test_moderation_worker import FakeModerationClient, _scores
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 90, 10)).save(buffer, "PNG")
    return buffer.getvalue()


async def _pending_photo(client: AsyncClient, token: str, product_id: str, seed: int) -> uuid.UUID:
    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(seed), "image/png")},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "PENDING"
    return uuid.UUID(response.json()["id"])


async def _admin_headers(client: AsyncClient, db: AsyncSession, email: str) -> dict[str, str]:
    await _register(client, "GUEST", email)
    await db.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id WHERE p.email = :email"
        ),
        {"email": email},
    )
    await db.commit()
    login = await client.post("/api/auth/login", json={"email": email, "password": "secret123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['token']}"}


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


async def test_setListingPreference_anyProduct_noTextGate_succeeds(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "mod.l1@example.com")
    item_id = await _register_personal_item(client, token, "Nowa nazwa bez bramki")

    listed = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
    )

    assert listed.status_code == 200, listed.text


@pytest.mark.parametrize(
    "value",
    [
        "Wózek, dzwoń 601 234 567",
        "kontakt 601234567",
        "+48 601-234-567",
        "pisz: jan.kowalski@gmail.com",
        "więcej na www.sklep.pl",
        "https://example.com/oferta",
        "olx.pl/oferta",
        "napisz na WhatsApp",
        "pisz na priv",
        "12 345 67 89",
    ],
)
def test_containsContactInfo_contactDetails_detected(value: str) -> None:
    assert contains_contact_info(value)


@pytest.mark.parametrize(
    "value",
    [
        "Body rozmiar 104-110-116",
        "Klocki Lego 10696",
        "Wózek 3w1, stan 9/10",
        "Książka ISBN 978-83-240-1234-5",
        "Buty r. 25, np. na jesień",
    ],
)
def test_containsContactInfo_ordinaryListing_notDetected(value: str) -> None:
    assert not contains_contact_info(value)


async def test_productTextWrites_contactInfo_return400WithPolishMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "mod.r1@example.com")
    await _register_personal_item(client, token, "Rowerek")
    product_id = await _resolve_product(client, token, "Rowerek")
    categories = (await client.get("/api/categories", headers=_auth(token))).json()

    resolved = await client.post(
        "/api/products/resolve",
        json={"name": "Rowerek tel 601 234 567", "category_id": categories[0]["id"]},
        headers=_auth(token),
    )
    described = await client.patch(
        f"/api/products/{product_id}/description",
        json={"description": "Odbiór po kontakcie: ala@example.com"},
        headers=_auth(token),
    )

    for response in (resolved, described):
        assert response.status_code == 400
        assert response.json()["message"] == CONTACT_INFO_MESSAGE


async def test_moderationQueue_admin_returnsPhotosOnly_nonAdmin403(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
) -> None:
    token, _ = await _register(client, "GUEST", "mod.q1@example.com")
    await _register_personal_item(client, token, "Kolejka admina")
    product_id = await _resolve_product(client, token, "Kolejka admina")
    photo_id = await _pending_photo(client, token, product_id, 2)
    await moderation_service.process_next(
        db_session, FakeModerationClient(_scores(violence=0.7)), fake_storage
    )
    admin = await _admin_headers(client, db_session, "mod.admin1@example.com")

    forbidden = await client.get("/api/moderation/queue", headers=_auth(token))
    queue = await client.get("/api/moderation/queue", headers=admin)

    assert forbidden.status_code == 403
    assert queue.status_code == 200, queue.text
    entries = queue.json()
    assert [entry["subject_type"] for entry in entries] == ["PHOTO"]
    entry = entries[0]
    assert "description" not in entry
    assert entry["subject_id"] == str(photo_id)
    assert entry["product_name"] == "Kolejka admina"
    assert entry["photo_url"].endswith("w1600.webp?signed")
    assert entry["scores"]["violence"] == pytest.approx(0.7)

    approve_photo = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "APPROVED"},
        headers=admin,
    )
    invalid_outcome = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "PENDING"},
        headers=admin,
    )

    assert approve_photo.status_code == 204
    assert invalid_outcome.status_code == 400
    photo = await db_session.get(ProductPhoto, photo_id)
    assert photo is not None and photo.status == ModerationStatus.APPROVED
    assert fake_storage.objects[photo.large_key].public is True
    assert (await client.get("/api/moderation/queue", headers=admin)).json() == []

    takedown = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "REJECTED"},
        headers=admin,
    )
    assert takedown.status_code == 204
    assert fake_storage.objects[photo.large_key].public is False
    admin_rows = (
        await db_session.execute(
            select(ModerationDecision).where(ModerationDecision.source == ModerationSource.ADMIN)
        )
    ).scalars()
    assert sorted(row.outcome for row in admin_rows) == [
        ModerationStatus.APPROVED,
        ModerationStatus.REJECTED,
    ]


async def test_moderationDecision_adminRejectsReviewPhotoWithPublicFile_filesMadePrivate(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "mod.acl@example.com")
    await _register_personal_item(client, token, "Plik publiczny w przegladzie")
    product_id = await _resolve_product(client, token, "Plik publiczny w przegladzie")
    photo_id = await _pending_photo(client, token, product_id, 7)
    photo = await db_session.get(ProductPhoto, photo_id)
    assert photo is not None
    fake_storage.objects[photo.large_key].public = True
    admin = await _admin_headers(client, db_session, "mod.acl.admin@example.com")

    response = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "REJECTED"},
        headers=admin,
    )

    assert response.status_code == 204
    assert fake_storage.objects[photo.large_key].public is False
    assert fake_storage.objects[photo.thumb_key].public is False


async def test_moderationDecision_productTextSubject_returns400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "mod.d1@example.com")
    await _register_personal_item(client, token, "Stary tekst produktu")
    product_id = await _resolve_product(client, token, "Stary tekst produktu")
    admin = await _admin_headers(client, db_session, "mod.admin2@example.com")

    response = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PRODUCT_TEXT", "subject_id": product_id, "outcome": "REJECTED"},
        headers=admin,
    )

    assert response.status_code == 400, response.text
    # The enum member stays so old PRODUCT_TEXT audit rows still load.
    assert ModerationSubjectType("PRODUCT_TEXT") is ModerationSubjectType.PRODUCT_TEXT


def test_resolveRequirement_moderationRoutes_resolveToAdmin() -> None:
    assert resolve_requirement("GET", "/api/moderation/queue") == ("ADMIN",)
    assert resolve_requirement("POST", "/api/moderation/decisions") == ("ADMIN",)


async def test_dispatchPending_excludeWorkerEvents_leavesThemPendingForWorker(
    db_session: AsyncSession,
) -> None:
    await outbox_service.append(
        db_session,
        event_type=PHOTO_MODERATION_REQUESTED,
        payload={"photo_id": uuid.uuid4()},
    )
    await outbox_service.append(db_session, event_type="test.other", payload={})
    await db_session.commit()

    claimed = await dispatch_pending(db_session, exclude_event_types=WORKER_EVENT_TYPES)

    assert claimed >= 1
    rows = await db_session.execute(
        select(OutboxEntry.event_type, OutboxEntry.status).where(
            OutboxEntry.event_type.in_([PHOTO_MODERATION_REQUESTED, "test.other"])
        )
    )
    statuses = {event_type: status for event_type, status in rows}
    assert {"moderation.photo_requested"} == WORKER_EVENT_TYPES
    assert statuses == {
        PHOTO_MODERATION_REQUESTED: OutboxStatus.PENDING,
        "test.other": OutboxStatus.PROCESSED,
    }
