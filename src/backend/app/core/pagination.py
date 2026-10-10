"""Page-number pagination for the admin list endpoints: `?page=&size=`
query parameters in, `{items, total, page, size}` out."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query
from pydantic import BaseModel

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
# Keeps OFFSET far inside bigint; deeper pages are a 400, not a 500.
MAX_PAGE = 10_000


@dataclass(frozen=True)
class PageParams:
    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


def _page_params(
    page: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 1,
    size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> PageParams:
    return PageParams(page=page, size=size)


Pagination = Annotated[PageParams, Depends(_page_params)]


class Page[T](BaseModel):
    """One page of `items` out of `total` matching rows."""

    items: list[T]
    total: int
    page: int
    size: int
