"""`app.locations` bounded context: a person's saved meeting places
(`Location`), owned by their PERSON party (`profile.party_id`) and reused
across the Circles and Terms they lead.

A GOOGLE row comes from the browser's Google Places (New) lookup. Its
`google_place_id` may be stored indefinitely; `formatted_address`, `lat` and
`lng` are cached Google data subject to Google's caching limits (currently
30 days for coordinates). Refreshing or re-geocoding them is out of scope,
and the backend never calls Google itself. `updated_at` is the cache
timestamp. A MANUAL row is typed by hand and carries no place_id or
coordinates."""
