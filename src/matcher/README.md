# aj-matcher

The wants matcher process (`python -m matcher`, compose service `matcher`).

Locally, outside Docker: `npm run matcher` from the repo root (stops the
compose `matcher`, then runs `uv run --system-certs --env-file ../backend/.env python -m matcher`
against the compose postgres). Start it again in Docker with
`docker compose start matcher`.

Commands, the Docker requirement of the test suite, and when backend schema
changes must also run this suite: `.maister/docs/project/architecture.md`,
section **Wants**, **Matcher commands**.
