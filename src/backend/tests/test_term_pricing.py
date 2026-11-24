"""Paid terms, pricing layer: circle defaults (`default_price`,
`default_payment_url`, derived `default_payment_method`), the by-value term
snapshot following the spec's inheritance table (an explicit `price: null`
with the URL omitted gives a free term without the inherited link), the
independent `model_fields_set` update rule, the price/URL validators with
the shared Polish copy, the "link requires a price" rule on every write path
and the price trio in the term, my-term and public-term shapes. Money is a
decimal string (`"25.50"`) on the wire, and the method is never read from
the request."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from app.groups.application.term_payments import PAYMENT_URL_REQUIRES_PRICE_MESSAGE
from app.groups.schemas import PAYMENT_URL_LENGTH_MESSAGE, PAYMENT_URL_MESSAGE, PRICE_MESSAGE
from tests.test_term_location_capacity import (
    _auth,
    _create_circle,
    _create_location,
    _create_term,
    _post_term,
    _register,
)

PAY_URL = "https://pay.example.pl/zajecia"


async def _priced_circle(
    client: AsyncClient, email: str, **defaults: Any
) -> tuple[str, dict[str, Any]]:
    token = await _register(client, email)
    location = await _create_location(client, token, f"ChIJ-{email}")
    group = await _create_circle(client, token, default_location_id=location["id"], **defaults)
    return token, group


def _trio(body: dict[str, Any], prefix: str = "") -> tuple[Any, Any, Any]:
    return (
        body[f"{prefix}price"],
        body[f"{prefix}payment_url"],
        body[f"{prefix}payment_method"],
    )


async def test_circleDefaults_createAndPatch_storedAsDecimalStringsWithDerivedMethod(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(
        client,
        "pricing.defaults@example.com",
        default_price="25.5",
        default_payment_url=PAY_URL,
        default_payment_method="PLATFORM",
    )
    assert _trio(group, "default_") == ("25.50", PAY_URL, "EXTERNAL_LINK")

    fetched = await client.get(f"/api/groups/{group['id']}", headers=_auth(token))
    assert _trio(fetched.json(), "default_") == ("25.50", PAY_URL, "EXTERNAL_LINK")

    url_cleared = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_payment_url": None},
        headers=_auth(token),
    )
    assert url_cleared.status_code == 200, url_cleared.text
    assert _trio(url_cleared.json(), "default_") == ("25.50", None, None)

    patched = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_price": 30, "default_payment_url": PAY_URL},
        headers=_auth(token),
    )
    assert patched.status_code == 200, patched.text
    assert _trio(patched.json(), "default_") == ("30.00", PAY_URL, "EXTERNAL_LINK")

    kept = await client.patch(
        f"/api/groups/{group['id']}", json={"name": "Nutki 2"}, headers=_auth(token)
    )
    assert _trio(kept.json(), "default_") == ("30.00", PAY_URL, "EXTERNAL_LINK")


async def test_createTerm_copiesDefaultsByValue_laterCircleEditDoesNotPropagate(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(
        client,
        "pricing.copy@example.com",
        default_price="25.50",
        default_payment_url=PAY_URL,
    )
    term = await _create_term(client, token, group["id"])
    assert _trio(term) == ("25.50", PAY_URL, "EXTERNAL_LINK")

    edited = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_price": None, "default_payment_url": None},
        headers=_auth(token),
    )
    assert edited.status_code == 200, edited.text

    fetched = await client.get(f"/api/terms/{term['id']}", headers=_auth(token))
    assert _trio(fetched.json()) == ("25.50", PAY_URL, "EXTERNAL_LINK")
    free = await _create_term(client, token, group["id"], days=4)
    assert _trio(free) == (None, None, None)


async def test_createTerm_explicitNullPriceUrlOmitted_isFreeWithoutInheritedLink(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(
        client,
        "pricing.m3@example.com",
        default_price="25.50",
        default_payment_url=PAY_URL,
    )

    free = await _create_term(client, token, group["id"], price=None)
    assert _trio(free) == (None, None, None)

    link_without_price = await _post_term(
        client, token, group["id"], price=None, payment_url=PAY_URL
    )
    assert link_without_price.status_code == 400, link_without_price.text
    assert link_without_price.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE

    override = await _create_term(
        client, token, group["id"], price="12", payment_url="https://inny.pl/p"
    )
    assert _trio(override) == ("12.00", "https://inny.pl/p", "EXTERNAL_LINK")

    price_only = await _create_term(client, token, group["id"], price="40")
    assert _trio(price_only) == ("40.00", PAY_URL, "EXTERNAL_LINK")
    url_dropped = await _create_term(client, token, group["id"], payment_url=None)
    assert _trio(url_dropped) == ("25.50", None, None)


async def test_updateTerm_nullClears_omittedKeeps_methodFollowsUrl(client: AsyncClient) -> None:
    token, group = await _priced_circle(client, "pricing.update@example.com")
    term = await _create_term(client, token, group["id"])
    assert _trio(term) == (None, None, None)

    async def patch(body: dict[str, Any]) -> dict[str, Any]:
        response = await client.patch(f"/api/terms/{term['id']}", json=body, headers=_auth(token))
        assert response.status_code == 200, response.text
        result: dict[str, Any] = response.json()
        return result

    assert _trio(await patch({"price": "19.9", "payment_url": PAY_URL})) == (
        "19.90",
        PAY_URL,
        "EXTERNAL_LINK",
    )
    assert _trio(await patch({"description": "Bez zmian ceny"})) == (
        "19.90",
        PAY_URL,
        "EXTERNAL_LINK",
    )
    assert _trio(await patch({"payment_url": None})) == ("19.90", None, None)
    assert _trio(await patch({"payment_url": PAY_URL, "payment_method": None})) == (
        "19.90",
        PAY_URL,
        "EXTERNAL_LINK",
    )
    assert _trio(await patch({"price": None, "payment_url": None})) == (None, None, None)


async def test_priceValidation_invalidValues_return400WithCopyText(client: AsyncClient) -> None:
    token, group = await _priced_circle(client, "pricing.price@example.com")

    for invalid in (0, -1, "100000.01", 1.234, "abc", True, "25,5", "NaN", "Infinity"):
        response = await _post_term(client, token, group["id"], price=invalid)
        assert response.status_code == 400, (invalid, response.text)
        assert response.json()["fieldErrors"]["price"] == PRICE_MESSAGE, invalid

    highest = await _create_term(client, token, group["id"], price=100000)
    assert highest["price"] == "100000.00"
    padded = await _create_term(client, token, group["id"], price="25.5")
    assert padded["price"] == "25.50"


async def test_paymentUrlValidation_rejectsNonHttpsAndTooLong_blankStoredAsNull(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(client, "pricing.url@example.com")

    for invalid in (
        "http://x.pl",
        "javascript:alert(1)",
        "https://",
        "https:///sciezka",
        "https://x.pl/a b",
        "https://bank.pl@evil.tld/p",
        "https://user:haslo@x.pl",
        "https://x.pl/\x00",
        "https://x.pl:99999",
        "https://x.pl:abc",
        "https://x.pl\\@evil.tld",
        "https://x.pl\\sciezka",
    ):
        response = await _post_term(client, token, group["id"], price="10", payment_url=invalid)
        assert response.status_code == 400, (invalid, response.text)
        assert response.json()["fieldErrors"]["payment_url"] == PAYMENT_URL_MESSAGE, invalid

    too_long = "https://x.pl/" + "a" * (501 - len("https://x.pl/"))
    response = await _post_term(client, token, group["id"], price="10", payment_url=too_long)
    assert response.status_code == 400, response.text
    assert response.json()["fieldErrors"]["payment_url"] == PAYMENT_URL_LENGTH_MESSAGE

    blank = await _create_term(client, token, group["id"], price="10", payment_url="   ")
    assert _trio(blank) == ("10.00", None, None)
    exact = await _create_term(client, token, group["id"], price="10", payment_url=" https://x.pl ")
    assert _trio(exact) == ("10.00", "https://x.pl", "EXTERNAL_LINK")
    longest = await _create_term(
        client, token, group["id"], price="10", payment_url=f"  {too_long[:500]}  "
    )
    assert longest["payment_url"] == too_long[:500]


async def test_paymentUrl_uppercaseHttpsScheme_acceptedAndStoredAsTyped(
    client: AsyncClient,
) -> None:
    upper = "HTTPS://Pay.Example.com/x"
    token, group = await _priced_circle(client, "pricing.upper@example.com")

    created = await _create_term(client, token, group["id"], price="10", payment_url=upper)
    assert _trio(created) == ("10.00", upper, "EXTERNAL_LINK")

    term = await _create_term(client, token, group["id"], price="10")
    updated = await client.patch(
        f"/api/terms/{term['id']}", json={"payment_url": upper}, headers=_auth(token)
    )
    assert updated.status_code == 200, updated.text
    assert _trio(updated.json()) == ("10.00", upper, "EXTERNAL_LINK")

    circle = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_price": 10, "default_payment_url": upper},
        headers=_auth(token),
    )
    assert circle.status_code == 200, circle.text
    assert _trio(circle.json(), "default_") == ("10.00", upper, "EXTERNAL_LINK")


async def test_paymentUrlWithoutPrice_returns400OnTermCreateTermUpdateAndGroupUpdate(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(client, "pricing.requires@example.com")

    created = await _post_term(client, token, group["id"], payment_url=PAY_URL)
    assert created.status_code == 400, created.text
    assert created.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE

    term = await _create_term(client, token, group["id"], price="15", payment_url=PAY_URL)
    cleared_price = await client.patch(
        f"/api/terms/{term['id']}", json={"price": None}, headers=_auth(token)
    )
    assert cleared_price.status_code == 400, cleared_price.text
    assert cleared_price.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE
    unchanged = await client.get(f"/api/terms/{term['id']}", headers=_auth(token))
    assert _trio(unchanged.json()) == ("15.00", PAY_URL, "EXTERNAL_LINK")

    group_update = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_payment_url": PAY_URL},
        headers=_auth(token),
    )
    assert group_update.status_code == 400, group_update.text
    assert group_update.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE

    circle_create = await client.post(
        "/api/groups/mine/new",
        json={"name": "Bez ceny", "default_payment_url": PAY_URL},
        headers=_auth(token),
    )
    assert circle_create.status_code == 400, circle_create.text
    assert circle_create.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE


async def test_effectiveState_mergesRequestWithStoredValues_onGroupUpdateAndTermCreate(
    client: AsyncClient,
) -> None:
    token, group = await _priced_circle(
        client,
        "pricing.effective@example.com",
        default_price="25.50",
        default_payment_url=PAY_URL,
    )

    price_cleared = await client.patch(
        f"/api/groups/{group['id']}",
        json={"name": "Nutki", "default_price": None},
        headers=_auth(token),
    )
    assert price_cleared.status_code == 400, price_cleared.text
    assert price_cleared.json()["message"] == PAYMENT_URL_REQUIRES_PRICE_MESSAGE
    unchanged = await client.get(f"/api/groups/{group['id']}", headers=_auth(token))
    assert _trio(unchanged.json(), "default_") == ("25.50", PAY_URL, "EXTERNAL_LINK")

    url_only = await _create_term(client, token, group["id"], payment_url="https://inny.pl/p")
    assert _trio(url_only) == ("25.50", "https://inny.pl/p", "EXTERNAL_LINK")


async def test_termShapes_carryPriceTrioWithoutPaymentStatus_andCopyTextsPinned(
    client: AsyncClient,
) -> None:
    assert PRICE_MESSAGE == "Podaj kwotę od 0,01 do 100 000 zł albo zostaw puste."
    assert PAYMENT_URL_MESSAGE == "Link musi zaczynać się od https://"
    assert PAYMENT_URL_LENGTH_MESSAGE == "Link do płatności może mieć najwyżej 500 znaków."
    assert PAYMENT_URL_REQUIRES_PRICE_MESSAGE == "Link wymaga ceny — wpisz cenę albo usuń link."

    token, group = await _priced_circle(
        client,
        "pricing.shapes@example.com",
        default_price="25.50",
        default_payment_url=PAY_URL,
    )
    term = await _create_term(client, token, group["id"])

    assert set(term) == {
        "id",
        "group_id",
        "occurs_on",
        "description",
        "created_at",
        "updated_at",
        "attendee_count",
        "child_count",
        "location",
        "capacity",
        "price",
        "payment_url",
        "payment_method",
    }

    public = await client.get(f"/api/public/groups/{group['id']}?term_id={term['id']}")
    assert public.status_code == 200, public.text
    public_term = public.json()["term"]
    assert set(public_term) == {
        "id",
        "occurs_on",
        "description",
        "needed_items",
        "item_listings",
        "location",
        "capacity",
        "attendee_count",
        "attendance_points",
        "price",
        "payment_url",
        "payment_method",
    }
    assert _trio(public_term) == ("25.50", PAY_URL, "EXTERNAL_LINK")

    mine = await client.get("/api/groups/mine/terms", params={"role": "led"}, headers=_auth(token))
    assert mine.status_code == 200, mine.text
    (my_term,) = mine.json()["items"]
    assert set(my_term) == {
        "id",
        "group_id",
        "group_name",
        "organizer_slug",
        "occurs_on",
        "description",
        "location",
        "capacity",
        "attendee_count",
        "child_count",
        "price",
        "payment_url",
        "payment_method",
    }
    assert _trio(my_term) == ("25.50", PAY_URL, "EXTERNAL_LINK")
    for shape in (term, public_term, my_term):
        assert "payment_status" not in shape
