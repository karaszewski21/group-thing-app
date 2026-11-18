"""The only way the measurement scripts reach a database: the disposable
PostgreSQL named by `DATABASE_URL` in the script's own process environment.
The URL is never printed, logged or written anywhere. Never the dev DB.

This file also owns that database:

    cd src/matcher
    uv run --system-certs python <this file> serve
        starts a PostgreSQL 18 testcontainer, runs the backend's
        `alembic upgrade head` (from `src/backend`, as the matcher's test
        conftest does) and holds the container until
        `docker stop wants-matcher-measurement-db`
    uv run --system-certs python <this file> run seed_measurement.py --items 20000 --wants 10000
        runs a script of this folder with `DATABASE_URL` set, in the child
        process only, to the held container; the child's `PYTHONPATH` is the
        current directory (`src/matcher` for the matcher scripts,
        `src/backend` for `measure_bells.py`)

Only the standard library is imported at module level, so both the matcher
and the backend environment can run it."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

DISPOSABLE_DATABASE = "wants_measure"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost"}
MARKER_TABLE = "wants_measurement_marker"
CONTAINER_NAME = "wants-matcher-measurement-db"
POSTGRES_PORT = 5432
BACKEND_ROOT = Path(__file__).resolve().parents[6] / "src" / "backend"


def disposable_url() -> str:
    """The `postgresql+asyncpg://` URL of this process; refuses anything but
    a loopback database called `wants_measure`."""
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        raise SystemExit("DATABASE_URL is not set in this process; refusing to guess a database.")
    parts = urlsplit(raw)
    if parts.hostname not in LOOPBACK_HOSTS or parts.path.lstrip("/") != DISPOSABLE_DATABASE:
        raise SystemExit(
            f"Refusing to run: the target is not a loopback database named {DISPOSABLE_DATABASE!r}."
        )
    return raw


def disposable_dsn() -> str:
    """The same URL in the form `asyncpg.connect` takes."""
    return disposable_url().replace("postgresql+asyncpg://", "postgresql://", 1)


async def claim_for_measurement(connection: Any) -> None:
    """Marks a database fresh from `alembic upgrade head` as the
    measurement's own (an asyncpg connection); refuses one that holds
    parties, items or wants and was not marked by an earlier seed."""
    if await connection.fetchval("SELECT to_regclass($1) IS NOT NULL", MARKER_TABLE):
        return
    holds_data = await connection.fetchval(
        "SELECT EXISTS (SELECT 1 FROM parties) OR EXISTS (SELECT 1 FROM inventory_items) "
        "OR EXISTS (SELECT 1 FROM wants)"
    )
    if holds_data:
        raise SystemExit("Refusing to run: the database holds data and is not a measurement one.")
    await connection.execute(f"CREATE TABLE {MARKER_TABLE} (seeded_at timestamp NOT NULL)")


def _container() -> Any:
    from testcontainers.community.postgres import PostgresContainer

    return PostgresContainer("postgres:18", dbname=DISPOSABLE_DATABASE).with_name(CONTAINER_NAME)


def _child_environment(port: int, pythonpath: Path) -> dict[str, str]:
    """The environment of a child process, pointing at the held container
    with the throwaway credentials testcontainers gives it."""
    container = _container()
    url = (
        f"postgresql+asyncpg://{container.username}:{container.password}"
        f"@localhost:{port}/{DISPOSABLE_DATABASE}"
    )
    return {
        **os.environ,
        "DATABASE_URL": url,
        "PYTHONPATH": str(pythonpath),
        "MODERATION_TEXT_ENABLED": "false",
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
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env=_child_environment(int(container.get_exposed_port(POSTGRES_PORT)), BACKEND_ROOT),
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
        env=_child_environment(_published_port(), Path.cwd()),
        check=False,
    ).returncode


if __name__ == "__main__":
    if sys.argv[1:] == ["serve"]:
        serve()
    elif len(sys.argv) > 2 and sys.argv[1] == "run":
        raise SystemExit(run(sys.argv[2], sys.argv[3:]))
    else:
        raise SystemExit("usage: measurement_db.py serve | run <script> [arguments]")
