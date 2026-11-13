"""`app.search` bounded context: the read-only global search behind
`GET /api/public/search` — listed items ("Przedmioty") and upcoming
meetings, groups and organizations ("Spotkania"), in the viewer's groups
("Moje grupy") or everywhere ("Wszędzie"). It owns no table and writes
nothing. Other contexts are reached only through `app.search.infrastructure`;
no module outside `app.search` except `app.main` imports it."""
