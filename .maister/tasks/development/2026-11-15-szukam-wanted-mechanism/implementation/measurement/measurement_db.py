"""The only way the measurement scripts reach a database: the disposable
PostgreSQL named by `DATABASE_URL` in the script's own process environment.
The URL is never printed, logged or written anywhere.

This file also owns that database (run from `src/backend`):

    uv run python <this file> serve
        starts a PostgreSQL 18 testcontainer, runs `alembic upgrade head`
        and holds the container until `docker stop wants-measurement-db`
    uv run python <this file> run seed_measurement.py --items 20000 --wants 10000
        runs a script of this folder with `DATABASE_URL` set, in the child
        process only, to the held container"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import URL, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

DISPOSABLE_DATABASE = "wants_measure"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost"}
MARKER_TABLE = "wants_measurement_marker"
CONTAINER_NAME = "wants-measurement-db"
POSTGRES_PORT = 5432
BACKEND_ROOT = Path(__file__).resolve().parents[6] / "src" / "backend"


def disposable_engine() -> AsyncEngine:
    """Refuses anything but a loopback database called `wants_measure`."""
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        raise SystemExit("DATABASE_URL is not set in this process; refusing to guess a database.")
    url = make_url(raw)
    if url.host not in LOOPBACK_HOSTS or url.database != DISPOSABLE_DATABASE:
        raise SystemExit(
            f"Refusing to run: the target is not a loopback database named {DISPOSABLE_DATABASE!r}."
        )
    return create_async_engine(url, hide_parameters=True)


async def claim_for_measurement(connection: AsyncConnection) -> None:
    """Marks a database fresh from `alembic upgrade head` as the
    measurement's own; refuses one that holds parties, items or wants and was
    not marked by an earlier seed."""
    marked = await connection.scalar(text("SELECT to_regclass(:name)"), {"name": MARKER_TABLE})
    if marked is not None:
        return
    holds_data = await connection.scalar(
        text(
            "SELECT EXISTS (SELECT 1 FROM parties) OR EXISTS (SELECT 1 FROM inventory_items) "
            "OR EXISTS (SELECT 1 FROM wants)"
        )
    )
    if holds_data:
        raise SystemExit("Refusing to run: the database holds data and is not a measurement one.")
    await connection.execute(text(f"CREATE TABLE {MARKER_TABLE} (seeded_at timestamp NOT NULL)"))


def _container() -> Any:
    from testcontainers.postgres import PostgresContainer

    return PostgresContainer("postgres:18", dbname=DISPOSABLE_DATABASE).with_name(CONTAINER_NAME)


def _child_environment(port: int) -> dict[str, str]:
    """The environment of a child process, pointing at the held container
    with the throwaway credentials testcontainers gives it."""
    container = _container()
    url = URL.create(
        "postgresql+asyncpg",
        container.username,
        container.password,
        "localhost",
        port,
        DISPOSABLE_DATABASE,
    )
    return {
        **os.environ,
        "DATABASE_URL": url.render_as_string(hide_password=False),
        "PYTHONPATH": str(BACKEND_ROOT),
    }


def _published_port() -> int:
    published = subprocess.run(
        ["docker", "port", CONTAINER_NAME, f"{POSTGRES_PORT}/tcp"],
        capture_output=True,
        text=True,
        check=False,
    )
    if published.returncode != 0 or not published.stdout.strip():
        raise SystemExit("The measurement container is not running; start it with `serve`.")
    return int(published.stdout.splitlines()[0].rsplit(":", 1)[1])


def serve() -> None:
    with _container() as container:
        migrated = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env=_child_environment(int(container.get_exposed_port(POSTGRES_PORT))),
            capture_output=True,
            check=False,
        )
        if migrated.returncode != 0:
            raise SystemExit(f"alembic upgrade head failed with exit code {migrated.returncode}.")
        print("ready: disposable PostgreSQL 18 at head", flush=True)
        container.get_wrapped_container().wait()


def run(script: str, arguments: list[str]) -> int:
    return subprocess.run(
        [sys.executable, str(Path(__file__).parent / Path(script).name), *arguments],
        cwd=BACKEND_ROOT,
        env=_child_environment(_published_port()),
        check=False,
    ).returncode


if __name__ == "__main__":
    if sys.argv[1:] == ["serve"]:
        serve()
    elif len(sys.argv) > 2 and sys.argv[1] == "run":
        raise SystemExit(run(sys.argv[2], sys.argv[3:]))
    else:
        raise SystemExit("usage: measurement_db.py serve | run <script> [arguments]")
