"""`app.moderation`: the worker's photo/text decisions (with fake
classifiers — the ONNX models are not loaded in tests), the ADMIN review
queue and decisions, synchronous contact-info rules, the listing guard for
non-approved product texts, and the outbox split between the API poller
and the worker."""

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
from app.moderation.events import TEXT_MODERATION_REQUESTED, WORKER_EVENT_TYPES
from app.moderation.models import ModerationDecision, ModerationSource
from app.moderation.rules import CONTACT_INFO_MESSAGE, contains_contact_info
from app.moderation.status import ModerationStatus
from app.outbox import service as outbox_service
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus
from app.product.models import Product, ProductPhoto
from tests.fake_storage import FakeStorage
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)


class FakeImageClassifier:
    model_id = "fake/nsfw"

    def __init__(self, nsfw: float) -> None:
        self._nsfw = nsfw

    def scores(self, image: bytes) -> dict[str, float]:
        return {"normal": 1 - self._nsfw, "nsfw": self._nsfw}


class FakeTextClassifier:
    model_id = "fake/bielik-guard"

    def __init__(self, sex: float) -> None:
        self._sex = sex
        self.calls: list[str] = []

    def scores(self, text: str) -> dict[str, float]:
        self.calls.append(text)
        return {"HATE": 0.01, "VULGAR": 0.02, "SEX": self._sex, "CRIME": 0.0, "SELF-HARM": 0.0}


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
    monkeypatch.setattr(settings, "moderation_enabled", True)


@pytest.mark.parametrize(
    ("nsfw", "expected", "public"),
    [
        (0.1, ModerationStatus.APPROVED, True),
        (0.7, ModerationStatus.NEEDS_REVIEW, False),
        (0.99, ModerationStatus.REJECTED, False),
    ],
)
async def test_moderatePhoto_nsfwScore_decidesByThresholdAndPublishesOnlyApproved(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
    nsfw: float,
    expected: ModerationStatus,
    public: bool,
) -> None:
    token, _ = await _register(client, "GUEST", f"mod.p{uuid.uuid4().hex[:6]}@example.com")
    await _register_personal_item(client, token, "Moderacja zdjęcia")
    product_id = await _resolve_product(client, token, "Moderacja zdjęcia")
    photo_id = await _pending_photo(client, token, product_id, 1)

    await moderation_service.moderate_photo(
        db_session, photo_id, FakeImageClassifier(nsfw), fake_storage
    )
    await db_session.commit()

    photo = await db_session.get(ProductPhoto, photo_id)
    assert photo is not None and photo.status == expected
    assert fake_storage.objects[photo.large_key].public is public
    assert fake_storage.objects[photo.thumb_key].public is public
    decision = (
        await db_session.execute(
            select(ModerationDecision).where(ModerationDecision.subject_id == photo_id)
        )
    ).scalar_one()
    assert (decision.source, decision.automated, decision.outcome) == (
        ModerationSource.AI,
        True,
        expected,
    )
    assert decision.model_id == "fake/nsfw"
    assert decision.scores == {"normal": pytest.approx(1 - nsfw), "nsfw": nsfw}


async def test_moderateProductText_flaggedOrStale_needsReviewOrSkipped(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "mod.t1@example.com")
    item_id = await _register_personal_item(client, token, "Body niemowlęce")
    product_id = uuid.UUID(await _resolve_product(client, token, "Body niemowlęce"))
    product = await db_session.get(Product, product_id)
    assert product is not None and product.text_status == ModerationStatus.PENDING
    first_hash = product.text_moderated_hash
    assert first_hash is not None

    described = await client.patch(
        f"/api/products/{product_id}/description",
        json={"description": "Rozmiar 62, bawełna"},
        headers=_auth(token),
    )
    assert described.status_code == 200, described.text
    await db_session.refresh(product)
    current_hash = product.text_moderated_hash
    assert current_hash != first_hash

    classifier = FakeTextClassifier(sex=0.8)
    await moderation_service.moderate_product_text(db_session, product_id, first_hash, classifier)
    assert classifier.calls == []  # stale version: a newer event covers the edit

    await moderation_service.moderate_product_text(
        db_session, product_id, str(current_hash), classifier
    )
    await db_session.commit()

    assert classifier.calls == ["Body niemowlęce\nRozmiar 62, bawełna"]
    await db_session.refresh(product)
    assert product.text_status == ModerationStatus.NEEDS_REVIEW
    stranger_token, _ = await _register(client, "GUEST", "mod.t2@example.com")
    details = await client.get(
        f"/api/inventory-items/{item_id}/details", headers=_auth(stranger_token)
    )
    assert details.json()["description"] is None
    owner_details = await client.get(
        f"/api/inventory-items/{item_id}/details", headers=_auth(token)
    )
    assert owner_details.json()["description"] == "Rozmiar 62, bawełna"


async def test_setListingPreference_productTextNotApproved_returns409(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "mod.l1@example.com")
    item_id = await _register_personal_item(client, token, "Nowa nazwa w moderacji")

    blocked = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
    )

    assert blocked.status_code == 409, blocked.text
    assert "w trakcie weryfikacji" in blocked.json()["message"]


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


async def test_moderationQueueAndDecisions_admin_reviewsPhotoAndText_nonAdmin403(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
) -> None:
    token, _ = await _register(client, "GUEST", "mod.q1@example.com")
    await _register_personal_item(client, token, "Kolejka admina")
    product_id = await _resolve_product(client, token, "Kolejka admina")
    photo_id = await _pending_photo(client, token, product_id, 2)
    await moderation_service.moderate_photo(
        db_session, photo_id, FakeImageClassifier(0.7), fake_storage
    )
    product = await db_session.get(Product, uuid.UUID(product_id))
    assert product is not None
    await moderation_service.moderate_product_text(
        db_session, product.id, str(product.text_moderated_hash), FakeTextClassifier(sex=0.9)
    )
    await db_session.commit()
    admin = await _admin_headers(client, db_session, "mod.admin1@example.com")

    forbidden = await client.get("/api/moderation/queue", headers=_auth(token))
    queue = await client.get("/api/moderation/queue", headers=admin)

    assert forbidden.status_code == 403
    assert queue.status_code == 200, queue.text
    entries = {entry["subject_type"]: entry for entry in queue.json()}
    assert entries["PHOTO"]["subject_id"] == str(photo_id)
    assert entries["PHOTO"]["photo_url"].endswith("w1600.webp?signed")
    assert entries["PHOTO"]["scores"]["nsfw"] == pytest.approx(0.7)
    assert entries["PRODUCT_TEXT"]["subject_id"] == product_id
    assert entries["PRODUCT_TEXT"]["product_name"] == "Kolejka admina"

    approve_photo = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "APPROVED"},
        headers=admin,
    )
    reject_text = await client.post(
        "/api/moderation/decisions",
        json={
            "subject_type": "PRODUCT_TEXT",
            "subject_id": product_id,
            "outcome": "REJECTED",
            "note": "Nieodpowiednia nazwa",
        },
        headers=admin,
    )
    invalid_outcome = await client.post(
        "/api/moderation/decisions",
        json={"subject_type": "PHOTO", "subject_id": str(photo_id), "outcome": "PENDING"},
        headers=admin,
    )

    assert (approve_photo.status_code, reject_text.status_code) == (204, 204)
    assert invalid_outcome.status_code == 400
    photo = await db_session.get(ProductPhoto, photo_id)
    assert photo is not None and photo.status == ModerationStatus.APPROVED
    assert fake_storage.objects[photo.large_key].public is True
    await db_session.refresh(product)
    assert product.text_status == ModerationStatus.REJECTED
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
        ModerationStatus.REJECTED,
    ]

    edited = await client.patch(
        f"/api/products/{product_id}/description",
        json={"description": "Poprawiony opis"},
        headers=_auth(token),
    )
    assert edited.status_code == 200
    await db_session.refresh(product)
    assert product.text_status == ModerationStatus.NEEDS_REVIEW  # rejected text goes to a human


def test_resolveRequirement_moderationRoutes_resolveToAdmin() -> None:
    assert resolve_requirement("GET", "/api/moderation/queue") == ("ADMIN",)
    assert resolve_requirement("POST", "/api/moderation/decisions") == ("ADMIN",)


async def test_dispatchPending_excludeWorkerEvents_leavesThemPendingForWorker(
    db_session: AsyncSession,
) -> None:
    await outbox_service.append(
        db_session,
        event_type=TEXT_MODERATION_REQUESTED,
        payload={"product_id": uuid.uuid4(), "content_hash": "x"},
    )
    await outbox_service.append(db_session, event_type="test.other", payload={})
    await db_session.commit()

    claimed = await dispatch_pending(db_session, exclude_event_types=WORKER_EVENT_TYPES)

    assert claimed >= 1
    statuses = dict(
        (
            await db_session.execute(
                select(OutboxEntry.event_type, OutboxEntry.status).where(
                    OutboxEntry.event_type.in_([TEXT_MODERATION_REQUESTED, "test.other"])
                )
            )
        ).all()
    )
    assert statuses == {
        TEXT_MODERATION_REQUESTED: OutboxStatus.PENDING,
        "test.other": OutboxStatus.PROCESSED,
    }
