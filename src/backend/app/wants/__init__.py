"""`app.wants` bounded context: what a party is looking for ("Szukam"), the
listed items matched to it and the notifications about them. It owns the
`wants`, `want_matches` and `want_scan_markers` tables. Other contexts are
reached only through `app.wants.infrastructure`; no module outside
`app.wants` except `app.main` imports it."""
