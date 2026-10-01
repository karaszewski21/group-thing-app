"""`/api/products/{product_id}/photos`: the catalog product's gallery, shared
by every inventory item of that product — add (URL validation, 10-photo
limit, duplicates), remove with dense renumbering, reorder by exact
permutation; mutations only for owners of an item of the product; deleting
the product takes its gallery along."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem, ReservationType
from app.product.models import ProductPhoto
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

INVALID_URL_MESSAGE = "Podaj poprawny link zaczynający się od http:// lub https://"


def _photos_url(product_id: str | uuid.UUID) -> str:
    return f"/api/products/{product_id}/photos"


async def _add_photo(
    client: AsyncClient, token: str, product_id: str, url: str
) -> dict[str, object]:
    response = await client.post(_photos_url(product_id), json={"url": url}, headers=_auth(token))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _list_photos(client: AsyncClient, token: str, product_id: str) -> list[dict]:
    response = await client.get(_photos_url(product_id), headers=_auth(token))
    assert response.status_code == 200, response.text
    return list(response.json())


async def test_addProductPhoto_validAndInvalidUrl_appendsSortOrderOr400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token_a, _ = await _register(client, "GUEST", "pph.a1@example.com")
    token_b, _ = await _register(client, "GUEST", "pph.b1@example.com")
    item_a = await _register_personal_item(client, token_a, "Galeria wspólna")
    item_b = await _register_personal_item(client, token_b, "Galeria wspólna")
    product_id = await _resolve_product(client, token_a, "Galeria wspólna")

    first = await _add_photo(client, token_a, product_id, "  https://example.com/1.jpg  ")
    second = await _add_photo(client, token_b, product_id, "http://example.com/2.jpg")

    assert (first["url"], first["sort_order"]) == ("https://example.com/1.jpg", 0)
    assert (second["url"], second["sort_order"]) == ("http://example.com/2.jpg", 1)
    listed = await _list_photos(client, token_b, product_id)
    assert [(p["id"], p["sort_order"]) for p in listed] == [(first["id"], 0), (second["id"], 1)]
    for token, item_id in ((token_a, item_a), (token_b, item_b)):
        details = await client.get(f"/api/inventory-items/{item_id}/details", headers=_auth(token))
        assert [p["url"] for p in details.json()["photos"]] == [
            "https://example.com/1.jpg",
            "http://example.com/2.jpg",
        ]

    for bad in ("ftp://x", "   ", "https://", "https://example.com/a b.jpg"):
        rejected = await client.post(
            _photos_url(product_id), json={"url": bad}, headers=_auth(token_a)
        )
        assert rejected.status_code == 400
        assert INVALID_URL_MESSAGE in rejected.json()["fieldErrors"].values()


async def test_addProductPhoto_eleventhOrDuplicate_returns409WithPolishMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a2@example.com")
    await _register_personal_item(client, token, "Galeria limit")
    product_id = await _resolve_product(client, token, "Galeria limit")
    await _add_photo(client, token, product_id, "https://example.com/0.jpg")

    duplicate = await client.post(
        _photos_url(product_id), json={"url": "https://example.com/0.jpg"}, headers=_auth(token)
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["message"] == "To zdjęcie jest już w galerii"

    for index in range(1, 10):
        await _add_photo(client, token, product_id, f"https://example.com/{index}.jpg")
    eleventh = await client.post(
        _photos_url(product_id), json={"url": "https://example.com/10.jpg"}, headers=_auth(token)
    )
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
        await client.post(
            _photos_url(unknown), json={"url": "https://example.com/x.jpg"}, headers=headers
        ),
        await client.delete(f"{_photos_url(unknown)}/{uuid.uuid4()}", headers=headers),
        await client.put(f"{_photos_url(unknown)}/order", json={"photo_ids": []}, headers=headers),
    ]

    assert [r.status_code for r in responses] == [404, 404, 404, 404]


async def test_removeProductPhoto_middlePhoto_renumbersRemainingDensely(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a4@example.com")
    await _register_personal_item(client, token, "Galeria usuwanie")
    product_id = await _resolve_product(client, token, "Galeria usuwanie")
    other_product_id = await _resolve_product(client, token, "Galeria inna")
    photos = [
        await _add_photo(client, token, product_id, f"https://example.com/r{index}.jpg")
        for index in range(3)
    ]
    foreign = ProductPhoto(
        product_id=uuid.UUID(other_product_id), url="https://example.com/f.jpg", sort_order=0
    )
    db_session.add(foreign)
    await db_session.commit()

    removed = await client.delete(
        f"{_photos_url(product_id)}/{photos[1]['id']}", headers=_auth(token)
    )
    assert removed.status_code == 204
    remaining = await _list_photos(client, token, product_id)
    assert [(p["id"], p["sort_order"]) for p in remaining] == [
        (photos[0]["id"], 0),
        (photos[2]["id"], 1),
    ]

    wrong_product = await client.delete(
        f"{_photos_url(product_id)}/{foreign.id}", headers=_auth(token)
    )
    assert wrong_product.status_code == 404
    assert len(await _list_photos(client, token, other_product_id)) == 1


async def test_reorderProductPhotos_permutationOrStaleList_reordersOr409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a5@example.com")
    await _register_personal_item(client, token, "Galeria kolejność")
    product_id = await _resolve_product(client, token, "Galeria kolejność")
    ids = [
        (await _add_photo(client, token, product_id, f"https://example.com/o{index}.jpg"))["id"]
        for index in range(3)
    ]
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
    photo = await _add_photo(client, owner_token, product_id, "https://example.com/c.jpg")
    headers = _auth(outsider_token)

    responses = [
        await client.post(
            _photos_url(product_id), json={"url": "https://example.com/x.jpg"}, headers=headers
        ),
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
    body = {"url": "https://example.com/lent.jpg"}

    by_owner = await client.post(url, json=body, headers=owner_headers)
    by_borrower = await client.post(url, json=body, headers=borrower_headers)

    assert by_owner.status_code == 201, by_owner.text
    assert by_borrower.status_code == 403


async def _photo_count(db: AsyncSession, product_id: str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(ProductPhoto)
            .where(ProductPhoto.product_id == uuid.UUID(product_id))
        )
        or 0
    )


async def test_deleteProduct_withPhotos_deletesGalleryOr409WhileItemsReferenceIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "pph.a8@example.com")
    await _register_personal_item(client, token, "Galeria z rzeczą")
    referenced_id = await _resolve_product(client, token, "Galeria z rzeczą")
    unreferenced_id = await _resolve_product(client, token, "Galeria bez rzeczy")
    await _add_photo(client, token, referenced_id, "https://example.com/d0.jpg")
    db_session.add_all(
        [
            ProductPhoto(
                product_id=uuid.UUID(unreferenced_id),
                url=f"https://example.com/u{index}.jpg",
                sort_order=index,
            )
            for index in range(2)
        ]
    )
    await db_session.commit()

    referenced = await client.delete(f"/api/products/{referenced_id}", headers=_auth(token))
    deleted = await client.delete(f"/api/products/{unreferenced_id}", headers=_auth(token))

    assert referenced.status_code == 409
    assert await _photo_count(db_session, referenced_id) == 1
    assert deleted.status_code == 204, deleted.text
    assert await _photo_count(db_session, unreferenced_id) == 0
    missing = await client.get(f"/api/products/{unreferenced_id}", headers=_auth(token))
    assert missing.status_code == 404
