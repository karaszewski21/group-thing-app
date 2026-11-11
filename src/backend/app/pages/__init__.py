"""`app.pages` bounded context: the read-only public owner pages — the
per-layout organization page, an organization's group terms page, the owner
items pages, the party profile and the owner meetings lists. It owns no
table and writes nothing. Other contexts are reached only through
`app.pages.infrastructure`; no module outside `app.pages` except `app.main`
imports it."""
