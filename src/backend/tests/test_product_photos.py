"""`/api/products/{product_id}/photos`: the catalog product's gallery, shared
by every inventory item of that product — multipart upload (sanitized to
WebP in two sizes, EXIF stripped, stored in object storage), the 10-photo
limit and duplicates, remove with dense renumbering and file deletion via
the outbox, reorder by exact permutation; mutations only for owners of an
item of the product; with moderation on, new photos stay private and are
hidden from non-owners until approved."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import AsyncClient, Response
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.circulation.models import InventoryItem, ReservationType
from app.config import settings
from app.moderation.status import ModerationStatus
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry
from app.product.models import ProductPhoto
from app.storage import outbox_listener as storage_outbox_listener
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage
from tests.test_circulation_ledger import (
    _confirm_and_fulfill,
    _register_item_via_api,
    _register_user,
    _reserve,
)
from tests.test_term_item_listings import (
    _auth,
    _register,
    _register_personal_item,
    _resolve_product,
)


def _image(
    seed: int, *, size: tuple[int, int] = (40, 30), fmt: str = "PNG", **save: object
) -> bytes:
    """A distinct small image per `seed` (distinct bytes, so no duplicate)."""
    buffer = io.BytesIO()
    Image.new("RGB", size, (seed * 37 % 256, seed * 11 % 256, 120)).save(buffer, fmt, **save)
    return buffer.getvalue()


def _photos_url(product_id: str | uuid.UUID) -> str:
    return f"/api/products/{product_id}/photos"


async def _upload(
    client: AsyncClient, token: str, product_id: str | uuid.UUID, data: bytes
) -> Response:
    return await client.post(
        _photos_url(product_id),
        files={"file": ("photo.png", data, "image/png")},
        headers=_auth(token),
    )


async def _add_photo(
    client: AsyncClient, token: str, product_id: str | uuid.UUID, seed: int
) -> dict[str, object]:
    response = await _upload(client, token, product_id, _image(seed))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _list_photos(client: AsyncClient, token: str, product_id: str) -> list[dict]:
    response = await client.get(_photos_url(product_id), headers=_auth(token))
    assert response.status_code == 200, response.text
    return list(response.json())


async def test_addProductPhoto_upload_storesSanitizedWebpAndAppendsSortOrder(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    token_a, _ = await _register(client, "GUEST", "pph.a1@example.com")
    token_b, _ = await _register(client, "GUEST", "pph.b1@example.com")
    item_a = await _register_personal_item(client, token_a, "Galeria wspólna")
    await _register_personal_item(client, token_b, "Galeria wspólna")
    product_id = await _resolve_product(client, token_a, "Galeria wspólna")
    exif = Image.Exif()
    exif[0x8825] = {2: (52.0, 13.0, 0.0)}  # GPS latitude
    exif[0x0112] = 6  # Orientation: rotate 90°
    big_jpeg = _image(1, size=(3200, 2000), fmt="JPEG", exif=exif.tobytes())

    first_response = await _upload(client, token_a, product_id, big_jpeg)
    second = await _add_photo(client, token_b, product_id, 2)

    assert first_response.status_code == 201, first_response.text
    first = first_response.json()
    assert (first["sort_order"], first["status"]) == (0, "APPROVED")
    assert second["sort_order"] == 1
    key = f"products/{product_id}/{first['id']}"
    assert first["url"] == f"https://cdn.test/{key}/w1600.webp"
    assert first["thumb_url"] == f"https://cdn.test/{key}/w400.webp"
    large = fake_storage.objects[f"{key}/w1600.webp"]
    thumb = fake_storage.objects[f"{key}/w400.webp"]
    assert (large.content_type, large.public) == ("image/webp", True)
    with Image.open(io.BytesIO(large.data)) as stored:
        assert stored.format == "WEBP"
        assert stored.size == (1000, 1600)  # EXIF rotation applied, then fit to 1600
        assert not stored.getexif()
    with Image.open(io.BytesIO(thumb.data)) as stored_thumb:
        assert max(stored_thumb.size) == 400

    details = await client.get(f"/api/inventory-items/{item_a}/details", headers=_auth(token_b))
    assert [p["id"] for p in details.json()["photos"]] == [first["id"], second["id"]]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"not an image at all", "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"),
        (_image(3, fmt="GIF"), "Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP"),
        (b"0" * (15 * 1024 * 1024 + 1), "Zdjęcie jest za duże (maks. 15 MB)"),
    ],
    ids=["text", "gif", "too-large"],
)
async def test_addProductPhoto_invalidOrTooLargeFile_returns400WithoutStoring(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    data: bytes,
    message: str,
) -> None:
    token, _ = await _register(client, "GUEST", f"pph.bad{uuid.uuid4().hex[:6]}@example.com")
    await _register_personal_item(client, token, "Galeria zły plik")
    product_id = await _resolve_product(client, token, "Galeria zły plik")

    response = await _upload(client, token, product_id, data)

    assert response.status_code == 400
    assert response.json()["message"] == message
    assert fake_storage.objects == {}


async def test_addProductPhoto_eleventhOrDuplicate_returns409WithPolishMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a2@example.com")
    await _register_personal_item(client, token, "Galeria limit")
    product_id = await _resolve_product(client, token, "Galeria limit")
    await _add_photo(client, token, product_id, 0)

    duplicate = await _upload(client, token, product_id, _image(0))
    assert duplicate.status_code == 409
    assert duplicate.json()["message"] == "To zdjęcie jest już w galerii"

    for seed in range(1, 10):
        await _add_photo(client, token, product_id, seed)
    eleventh = await _upload(client, token, product_id, _image(10))
    assert eleventh.status_code == 409
    assert eleventh.json()["message"] == "Osiągnięto limit 10 zdjęć"
    assert len(await _list_photos(client, token, product_id)) == 10


async def test_productPhotoRoutes_unknownProduct_return404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a3@example.com")
    unknown = uuid.uuid4()
    headers = _auth(token)

    responses = [
        await client.get(_photos_url(unknown), headers=headers),
        await _upload(client, token, unknown, _image(1)),
        await client.delete(f"{_photos_url(unknown)}/{uuid.uuid4()}", headers=headers),
        await client.put(f"{_photos_url(unknown)}/order", json={"photo_ids": []}, headers=headers),
    ]

    assert [r.status_code for r in responses] == [404, 404, 404, 404]


async def test_removeProductPhoto_middlePhoto_renumbersAndDeletesFilesViaOutbox(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a4@example.com")
    other_token, _ = await _register(client, "GUEST", "pph.b4@example.com")
    await _register_personal_item(client, token, "Galeria usuwanie")
    await _register_personal_item(client, other_token, "Galeria inna")
    product_id = await _resolve_product(client, token, "Galeria usuwanie")
    other_product_id = await _resolve_product(client, token, "Galeria inna")
    photos = [await _add_photo(client, token, product_id, seed) for seed in range(3)]
    foreign = await _add_photo(client, other_token, other_product_id, 7)

    removed = await client.delete(
        f"{_photos_url(product_id)}/{photos[1]['id']}", headers=_auth(token)
    )
    assert removed.status_code == 204
    remaining = await _list_photos(client, token, product_id)
    assert [(p["id"], p["sort_order"]) for p in remaining] == [
        (photos[0]["id"], 0),
        (photos[2]["id"], 1),
    ]

    removed_key = f"products/{product_id}/{photos[1]['id']}/w1600.webp"
    assert removed_key in fake_storage.objects
    monkeypatch.setattr(storage_outbox_listener, "get_storage", lambda: fake_storage)
    storage_outbox_listener.register()
    await dispatch_pending(db_session, event_types={OBJECTS_DELETE})
    assert removed_key not in fake_storage.objects
    assert f"products/{product_id}/{photos[0]['id']}/w1600.webp" in fake_storage.objects

    wrong_product = await client.delete(
        f"{_photos_url(product_id)}/{foreign['id']}", headers=_auth(token)
    )
    assert wrong_product.status_code == 404
    assert len(await _list_photos(client, token, other_product_id)) == 1


async def test_reorderProductPhotos_permutationOrStaleList_reordersOr409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a5@example.com")
    await _register_personal_item(client, token, "Galeria kolejność")
    product_id = await _resolve_product(client, token, "Galeria kolejność")
    ids = [(await _add_photo(client, token, product_id, seed))["id"] for seed in range(3)]
    order_url = f"{_photos_url(product_id)}/order"

    reordered = await client.put(
        order_url, json={"photo_ids": [ids[2], ids[0], ids[1]]}, headers=_auth(token)
    )
    assert reordered.status_code == 200, reordered.text
    assert [(p["id"], p["sort_order"]) for p in reordered.json()] == [
        (ids[2], 0),
        (ids[0], 1),
        (ids[1], 2),
    ]
    assert [p["id"] for p in await _list_photos(client, token, product_id)] == [
        ids[2],
        ids[0],
        ids[1],
    ]

    for stale in ([ids[0], ids[1]], [*ids, str(uuid.uuid4())], [ids[0], ids[0], ids[1]]):
        conflict = await client.put(order_url, json={"photo_ids": stale}, headers=_auth(token))
        assert conflict.status_code == 409
        assert conflict.json()["message"] == "Lista zdjęć jest nieaktualna — odśwież stronę"

    too_many = await client.put(
        order_url, json={"photo_ids": [str(uuid.uuid4()) for _ in range(11)]}, headers=_auth(token)
    )
    assert too_many.status_code == 400


async def test_productPhotoMutations_editTokenWithoutOwnedItem_returns403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "GUEST", "pph.owner6@example.com")
    outsider_token, _ = await _register(client, "GUEST", "pph.outsider6@example.com")
    await _register_personal_item(client, owner_token, "Galeria cudza")
    product_id = await _resolve_product(client, owner_token, "Galeria cudza")
    photo = await _add_photo(client, owner_token, product_id, 1)
    headers = _auth(outsider_token)

    responses = [
        await _upload(client, outsider_token, product_id, _image(2)),
        await client.delete(f"{_photos_url(product_id)}/{photo['id']}", headers=headers),
        await client.put(
            f"{_photos_url(product_id)}/order", json={"photo_ids": [photo["id"]]}, headers=headers
        ),
    ]

    assert [r.status_code for r in responses] == [403, 403, 403]
    assert [p["id"] for p in await _list_photos(client, outsider_token, product_id)] == [
        photo["id"]
    ]


async def test_productPhotoMutations_ownerWhileItemLentOut_allowedBorrowerForbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "pph.owner7@example.com")
    borrower_headers, borrower_id = await _register_user(client, "pph.borrower7@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    item = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()
    assert item.home_inventory_id is not None
    url = _photos_url(item.product_id)

    def files() -> dict[str, tuple[str, bytes, str]]:
        return {"file": ("lent.png", _image(5), "image/png")}

    by_owner = await client.post(url, files=files(), headers=owner_headers)
    by_borrower = await client.post(url, files=files(), headers=borrower_headers)

    assert by_owner.status_code == 201, by_owner.text
    assert by_borrower.status_code == 403


async def test_addPhoto_imageModerationDisabled_approvedPublic(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    token, _ = await _register(client, "GUEST", "pph.off1@example.com")
    await _register_personal_item(client, token, "Galeria bez moderacji")
    product_id = await _resolve_product(client, token, "Galeria bez moderacji")

    photo = await _add_photo(client, token, product_id, 1)

    assert photo["status"] == "APPROVED"
    key = f"products/{product_id}/{photo['id']}"
    assert fake_storage.objects[f"{key}/w1600.webp"].public is True
    events = (
        await db_session.execute(
            select(OutboxEntry).where(OutboxEntry.event_type == "moderation.photo_requested")
        )
    ).all()
    assert events == []


async def test_addPhoto_imageModerationEnabled_pendingPrivateNoOutboxEvent(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    owner_token, _ = await _register(client, "GUEST", "pph.mod1@example.com")
    other_token, _ = await _register(client, "GUEST", "pph.mod2@example.com")
    item_id = await _register_personal_item(client, owner_token, "Galeria moderowana")
    product_id = await _resolve_product(client, owner_token, "Galeria moderowana")

    photo = await _add_photo(client, owner_token, product_id, 1)

    assert photo["status"] == "PENDING"
    key = f"products/{product_id}/{photo['id']}"
    assert photo["url"] == f"https://origin.test/{key}/w1600.webp?signed"
    assert fake_storage.objects[f"{key}/w1600.webp"].public is False
    assert fake_storage.objects[f"{key}/w400.webp"].public is False
    # VPS B's cron reads PENDING photos straight from the table; no event.
    events = (
        await db_session.execute(
            select(OutboxEntry).where(OutboxEntry.event_type == "moderation.photo_requested")
        )
    ).all()
    assert events == []

    assert [p["id"] for p in await _list_photos(client, owner_token, product_id)] == [photo["id"]]
    assert await _list_photos(client, other_token, product_id) == []
    other_details = await client.get(
        f"/api/inventory-items/{item_id}/details", headers=_auth(other_token)
    )
    assert other_details.json()["photos"] == []


async def _photo_count(db: AsyncSession, product_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(ProductPhoto)
            .where(ProductPhoto.product_id == uuid.UUID(product_id))
        )
        or 0
    )


def _photo_row(product_id: str, user_id: uuid.UUID, sort_order: int) -> ProductPhoto:
    photo_id = uuid.uuid4()
    return ProductPhoto(
        id=photo_id,
        product_id=uuid.UUID(product_id),
        storage_key=f"products/{product_id}/{photo_id}",
        width=10,
        height=10,
        size_bytes=100,
        content_sha256=photo_id.hex * 2,
        status=ModerationStatus.APPROVED,
        uploaded_by_user_id=user_id,
        sort_order=sort_order,
    )


async def test_deleteProduct_withPhotos_deletesGalleryAndFilesOr409WhileItemsReferenceIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a8@example.com")
    await _register_personal_item(client, token, "Galeria z rzeczą")
    referenced_id = await _resolve_product(client, token, "Galeria z rzeczą")
    unreferenced_id = await _resolve_product(client, token, "Galeria bez rzeczy")
    await _add_photo(client, token, referenced_id, 0)
    user_id = (await db_session.execute(select(User.id).limit(1))).scalar_one()
    db_session.add_all([_photo_row(unreferenced_id, user_id, index) for index in range(2)])
    await db_session.commit()

    referenced = await client.delete(f"/api/products/{referenced_id}", headers=_auth(token))
    deleted = await client.delete(f"/api/products/{unreferenced_id}", headers=_auth(token))

    assert referenced.status_code == 409
    assert await _photo_count(db_session, referenced_id) == 1
    assert deleted.status_code == 204, deleted.text
    assert await _photo_count(db_session, unreferenced_id) == 0
    file_delete = (
        await db_session.execute(
            select(OutboxEntry).where(OutboxEntry.event_type == OBJECTS_DELETE)
        )
    ).scalar_one()
    assert len(file_delete.payload["keys"]) == 4
    missing = await client.get(f"/api/products/{unreferenced_id}", headers=_auth(token))
    assert missing.status_code == 404
