# External findings: matching wants to items (reverse search, PostgreSQL, Polish text, triggers, deduplication)

## TL;DR
- The reference design is reverse search: store each want as a query, run every new item against the stored queries (Elasticsearch percolator). PostgreSQL has no percolator, but a stored `tsquery` column matched with `@@` against the new item's `tsvector` does the same job.
- No built-in index speeds up `tsvector @@ stored_tsquery`: GiST `tsquery_ops` indexes only `@>` and `<@` between two tsqueries, and GIN has no tsquery operator class. At thousands of wants a filtered scan (category, radius, active) is the realistic plan.
- PostgreSQL 18 ships no Polish stemmer or configuration; PostgreSQL 19 (RC 2 on 2026-11-12, not yet GA) adds a Snowball Polish stemmer. On 18 the choices are an ispell/hunspell dictionary copied into the server image, trigram tolerance, prefix matching, an application-side lemmatiser, or embeddings.
- Match in both directions: new item against stored wants (reverse), new want against listed items (an ordinary search, capped into one summary). Run it from the outbox, not in the request.
- Deduplicate with a match table keyed by (want, item) and `INSERT ... ON CONFLICT DO NOTHING`; notify only for rows actually inserted.

## Key Decisions
- Stored `tsquery` per want, not a search engine — the percolator's selling point is scale (hundreds of thousands of queries per shard); at thousands of wants PostgreSQL evaluates every candidate directly.
- Do not rely on a GiST index on the tsquery column for `@@` — the official operator-class table lists only `<@` and `@>` for `tsquery_ops`.
- Pre-filter stored wants by structured fields (active, category, radius) before text matching — the same advice AWS gives for percolators, and the only indexable part on PostgreSQL.
- Treat exact-lexeme AND matching as too strict for Polish — inflection breaks it without stemming; pair it with a trigram or prefix fallback, or add a dictionary.
- Keep embeddings as an optional later path — a 384-dimension small model fits the "small models" rule, but adds a model, a threshold to tune and an extension, for a corpus that exact search already covers.
- Match table with a unique (want, item) key as the idempotency point — outbox relays can deliver twice, so the consumer must be idempotent.

## Open Questions / Risks
- Unconfirmed: whether `stored_query <@ doc_query` (GiST-indexable) is a usable candidate filter for AND-only wants. It follows from the documented semantics but was not tested; needs an `EXPLAIN` experiment.
- Unconfirmed: CPU latency and memory of a small multilingual embedding model under ONNX on the app server; no source opened gives figures.
- Unconfirmed: quality of the PostgreSQL 19 Snowball Polish stemmer on short marketplace texts; its own page lists heuristics and unimplemented parts.
- The order of folding and stemming matters: Polish dictionaries and the Snowball stemmer expect diacritics, so folding before stemming would defeat them (inference from the stemmer and unaccent documentation; not tested against `fold_pl()`).
- An ispell dictionary is loaded per session and costs CPU and RAM per connection; the `shared_ispell` extension that fixes this lists support only up to PostgreSQL 17.
- The PostgreSQL 18 release notes page could not be opened (connection error); statements about 18 rest on the 18 documentation pages and the `REL_18_STABLE` source.
- Upgrading to PostgreSQL 19 later changes full-text and pg_trgm character classification; the 19 notes recommend reindexing and recomputing stored `tsvector` values after `pg_upgrade`.

All URLs below were opened on 2026-11-14 unless a line says otherwise.

---

## 1. Reverse search: the reference model

### 1.1 Elasticsearch percolator
- **What it is**: the `percolate` query "contains the document that will be used as query to match with the stored queries". Queries are indexed into a `percolator` field; a new document is matched against them.
- **How it works**: at index time the stored query's terms are extracted and indexed. At search time the document goes into a temporary in-memory index ("can just hold this one document and it is optimized for that"); the document's terms select candidate queries, which are then verified. Queries without extractable terms (wildcard, geo shape) cannot use the candidate step.
- **Batching**: several documents can be percolated in one request; hits carry `_percolator_document_slot`.
- **Scoring cost**: use filter context when scores are not needed, because scoring "requires to deserialize each matching query and run it against the percolated document".
- Source: https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-percolate-query.html — confidence high (first-party).

### 1.2 When percolation is the right tool
- Elastic's own guidance (2015, Elasticsearch 2.0 era): percolator suits "the need to spot new documents of interest" one at a time, in real time; scheduled queries (Watcher) suit trend questions over many documents. Named example: an e-commerce site notifying users of newly listed products (many queries, low document rate).
- Response time grows linearly with the number of stored queries; the article's worked sizing reaches about 250,000 queries per shard for a one-second target.
- Alerting is not automatic — the application decides what to do with matches.
- Source: https://www.elastic.co/blog/when-and-how-to-percolate-1 — confidence medium (first-party but dated).

### 1.3 Pre-filter stored queries by metadata
- AWS advises: "Prefer using query filters to reduce matching queries to percolate from percolation index" — store plain fields next to each query and filter on them first. It also recommends a buffer between ingestion and percolation so matching can be batched.
- Source: https://aws.amazon.com/blogs/big-data/working-with-percolators-in-amazon-opensearch-service (2023-04-27) — confidence high.
- Relevance: for a want, the plain fields are status, category, locality point and radius. These are the indexable part on PostgreSQL too.

### 1.4 Production example: Funda (property portal, 2024)
- A matcher service listens for new-listing events, runs percolate queries against a saved-search index and stores matches in a database; push is sent per match, email from a daily workflow over stored matches.
- Editing a saved search deletes it and creates a new one with a new id; matches of the old id drop out of the feed and are removed later by retention.
- Scale: over 1 million saved searches, over 4 million matches a day, over 200,000 emails a day. Percolation replaced a custom reverse index the team no longer wanted to maintain.
- Source: https://blog.funda.nl/how-we-enhanced-the-saved-search-feature-with-opensearch/ (2024-03-19) — confidence high for the architecture, medium for transfer to this scale (three orders of magnitude larger).
- Other portals reported in search results as using percolation (Homegate, REA Group, Trulia, Xome) were **not opened** — unconfirmed.

---

## 2. PostgreSQL equivalents

### 2.1 Stored `tsquery` matched against a new document
- `@@` works in either order: "`tsquery @@ tsvector` → boolean ... (The arguments can be given in either order.)" — https://www.postgresql.org/docs/18/functions-textsearch.html and https://www.postgresql.org/docs/18/textsearch-intro.html — confidence high.
- `tsquery` is an ordinary column type. The documentation itself stores tsqueries in a table (`CREATE TABLE aliases (t tsquery PRIMARY KEY, s tsquery)`) in the query-rewriting section — https://www.postgresql.org/docs/18/textsearch-features.html — confidence high.
- A `tsquery` cast does not normalise words: "any required normalization of words must be done before converting to the `tsquery` type"; use `to_tsquery`, `plainto_tsquery` or `websearch_to_tsquery` with an explicit configuration — https://www.postgresql.org/docs/18/datatype-textsearch.html — confidence high.
- `plainto_tsquery` yields a query that "matches documents containing all non-stopwords in the text" (AND of every word). `websearch_to_tsquery` understands quotes, `or` and `-` — https://www.postgresql.org/docs/18/functions-textsearch.html — confidence high.
- A worked application of exactly this pattern (stored `tsquery` column, new text converted with `to_tsvector` and filtered with `@@`, ranked with `ts_rank`), described as the PostgreSQL counterpart of percolate: https://www.stefanwienert.de/blog/2020/11/03/postgresql-reverse-search/ (2020) — confidence medium (one practitioner, no measurements, no query plans).

### 2.2 Indexing stored queries: what the documentation actually supports
- "`CREATE INDEX ... USING GIST (column ...)` ... The column can be of `tsvector` or `tsquery` type", while a GIN text-search index requires `tsvector` — https://www.postgresql.org/docs/18/textsearch-indexes.html — confidence high.
- The built-in GiST operator-class table lists for `tsquery_ops` only `<@ (tsquery, tsquery)` and `@> (tsquery, tsquery)`; `@@ (tsvector, tsquery)` appears only under `tsvector_ops` — https://www.postgresql.org/docs/18/gist.html — confidence high.
- The built-in GIN table has no operator class for `tsquery` (`tsvector_ops` with `@@`, `array_ops` with `&&`, `@>`, `<@`, `=`) — https://www.postgresql.org/docs/18/gin.html — confidence high.
- **Consequence**: `WHERE new_item_vector @@ wants.query` cannot use an index on `wants.query`. The GiST index in the Wienert post is created but the post shows no plan proving it is used; by the operator-class table it cannot serve that predicate. Confidence high (documentation), with the reading of the blog post medium.
- Containment semantics: `tsquery <@ tsquery` "considers only whether all the lexemes appearing in one query appear in the other, ignoring the combining operators" — https://www.postgresql.org/docs/18/functions-textsearch.html — confidence high.
- **Inference, unconfirmed**: for wants that are a plain AND of lexemes, "all want lexemes occur in the item" equals `want.query <@ item_query`, where `item_query` is built from the item's lexemes. That predicate is GiST-indexable and mirrors the percolator's candidate-selection step. Not found in any source and not tested; GiST text-search indexes are lossy and rechecked (https://www.postgresql.org/docs/18/textsearch-indexes.html). Confidence low.
- `querytree(tsquery)` shows the indexable part of a query and detects queries made only of stop words or negations — useful as a validity check when a want is saved — https://www.postgresql.org/docs/18/textsearch-features.html — confidence high.

### 2.3 Trigram similarity
- `similarity`, `word_similarity` (best match against "any continuous extent" of the second string) and `strict_word_similarity` (extent forced to word boundaries); operators `%`, `<%`, `<<%` with default thresholds 0.3, 0.6 and 0.5 — https://www.postgresql.org/docs/18/pgtrgm.html — confidence high.
- GiST and GIN trigram indexes "support the above-described similarity operators" and `LIKE`/`ILIKE`/regex; nearest-neighbour ordering works with GiST, not GIN. Comparisons are case-insensitive; non-alphanumerics are ignored — same page — confidence high.
- The documentation positions trigrams as a companion to full-text search: "it can help to recognize misspelled input words that will not be matched directly by the full text search mechanism" — same page — confidence high.
- Direction note (inference): in the reverse direction the indexed column would be the want text and the probe the item title; `want_text <% item_title` asks whether the short want resembles some stretch of the title. An index on the item side serves the forward direction (new want against items). Confidence medium.

### 2.4 Plain scan at small scale
- Percolator cost itself is linear in the number of stored queries (section 1.2); its advantage is the candidate-selection index plus horizontal scale. With thousands of wants, a statement that first narrows by indexed plain columns and then evaluates `@@` (and optionally a trigram operator) on the remainder does the same work without extra infrastructure. This is reasoning from the sources above, not a measured result — confidence medium.
- Ranking has a cost of its own: "Ranking can be expensive since it requires consulting the `tsvector` of each matching document" — https://www.postgresql.org/docs/18/textsearch-controls.html — relevant only to the new-want direction, where many items may match — confidence high.

### 2.5 Option summary

| Option | How it works | Fit with the stack | Cost at this scale | Risks | Sources |
|--------|--------------|--------------------|--------------------|-------|---------|
| Stored `tsquery`, scan after plain-column pre-filter | `item_vector @@ want.query` over active wants in the item's category and radius | Reuses existing tsvector and folding | Negligible | Strict AND misses inflected forms | PG docs 2.1, 2.2 |
| Stored `tsquery` + GiST `tsquery_ops` with `<@` | Candidate filter by lexeme containment | Same | Extra index, unproven benefit | Untested; lossy; only AND-style wants | PG docs 2.2 (inference) |
| Trigram word similarity | `<%` / `word_similarity` between want text and item title | pg_trgm already installed | Small | Threshold tuning; false positives on short words | pg_trgm docs |
| Forward search only, periodic | Re-run each want as a normal search on a schedule | No reverse logic at all | One query per want per run | Delay; repeated work; first-run flood | Elastic blog 1.2, polling post in section 4 |
| Elasticsearch/OpenSearch percolator | Dedicated engine | New service to run | High for this size | Operational weight | Elastic, AWS, Funda |
| Embeddings + pgvector | Cosine distance between want and item vectors | Needs model and extension | Model inference per item and per want | Threshold choice; see section 3.5 | pgvector, model cards |

---

## 3. Polish text

### 3.1 What PostgreSQL 18 ships
- The Snowball stemmer list in the PostgreSQL 18 source has no Polish (Slavic languages present: Russian, Serbian) — https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/snowball/Makefile — confidence high.
- A 2026 walkthrough confirms it on a live server: on 18, `\dF polish` returns no rows — https://www.depesz.com/?p=4454 (2026-04-21) — confidence high.
- The dictionary documentation names no Polish support and states: "The standard PostgreSQL distribution does not include any Ispell configuration files" — https://www.postgresql.org/docs/18/textsearch-dictionaries.html — confidence high.

### 3.2 PostgreSQL 19 adds a Polish stemmer
- 19 release notes (documentation for 19rc2; banner "19 RC 2 Released!" dated 2026-11-12; release date still shown as "2026-??-??"): "Add full text stemmers for Polish and Esperanto (Tom Lane)" — https://www.postgresql.org/docs/19/release-19.html — confidence high.
- The development branch's Snowball list includes `polish` — https://raw.githubusercontent.com/postgres/postgres/master/src/backend/snowball/Makefile — confidence high.
- The same notes carry a migration item: full text search and pg_trgm now use the database's locale provider for character classification, and "it is recommended to reindex all indexes which use full text search and pg_trgm after the upgrade, and to recompute any stored `tsvector` values" — confidence high.
- The stemmer's own description (author Dmitry Shachnev): removes inflectional suffixes only, leaves derivational ones; superlative prefix `naj-` "is currently not implemented"; some rules are heuristics that do "the right thing in common cases"; it removes the acute mark from ć, ń, ś, ź in some cases and keeps other diacritics such as ą and ł — https://snowballstem.org/algorithms/polish/stemmer.html, listed at https://snowballstem.org/algorithms/ — confidence high for the description; quality on short second-hand listings unconfirmed.

### 3.3 Ispell / hunspell dictionary on PostgreSQL 18
- Supported formats: Ispell, "MySpell (OO < 2.0.1) and Hunspell (OO >= 2.0.2)"; files go into `$SHAREDIR/tsearch_data` and "must be stored in UTF-8 encoding"; PostgreSQL implements "only the basic compound word operations of Hunspell" — https://www.postgresql.org/docs/18/textsearch-dictionaries.html — confidence high.
- Ispell dictionaries "usually recognize a limited set of words, so they should be followed by another broader dictionary" such as `simple` — same page — confidence high. For this platform that means brand names and slang fall through unstemmed.
- Recipe for 18 (depesz, 2026): Debian's `hunspell-pl` package places `pl_pl.affix` and `pl_pl.dict` in `tsearch_data`; elsewhere take `pl_PL.aff`/`pl_PL.dic` from LibreOffice dictionaries and convert from ISO-8859-2 with `iconv`; create an ispell dictionary and map word token types to `polish_hunspell, simple`. One word can yield several lexemes (the post's example "Niepokojące" gives two lemmas). A missing `.stop` file makes `StopWords` fail — https://www.depesz.com/?p=4454 — confidence high.
- Operational cost:
  - The files must exist on the database server's filesystem, so a stock `postgres:18` container needs a custom image or a mounted directory, on every environment including test containers (inference from the documented file location; confidence high).
  - Per-session load: "each session initializes and stores the dictionary on it's own, which means a lot of CPU/RAM is wasted"; the `shared_ispell` extension keeps one copy in shared memory but its README states "PostgreSQL version is from 9.6 to 17" — https://github.com/postgrespro/shared_ispell — confidence high for the statement, unconfirmed for 18 compatibility.
  - A historical report of slow Polish ispell processing: Tom Lane profiled it in 2009 and found "about 55% of the time is going into affix pattern matching" on multibyte text — https://www.postgresql.org/message-id/15251.1258645873%40sss.pgh.pa.us — confidence medium; whether later releases fixed it is unconfirmed.
  - Generated columns may use "only ... immutable functions" (https://www.postgresql.org/docs/18/ddl-generated-columns.html), and the documentation warns to name the configuration explicitly so results do not change with `default_text_search_config` (https://www.postgresql.org/docs/18/textsearch-features.html). Changing the dictionary means rebuilding every stored `tsvector` and every stored want `tsquery` (inference; confidence high).

### 3.4 Folding, prefixes and trigram fallbacks (no dictionary)
- `unaccent` is "a filtering dictionary, which means its output is always passed to the next dictionary", used to make full-text search accent-insensitive — https://www.postgresql.org/docs/18/unaccent.html — confidence high. The page does not state the function's volatility; the usual immutable-wrapper practice is therefore unconfirmed here (the project already has its own immutable folding function).
- Prefix matching: "lexemes in a `tsquery` can be labeled with `*` to specify prefix matching" — https://www.postgresql.org/docs/18/datatype-textsearch.html — confidence high. Inference: a want stored as prefix lexemes of truncated words is a cheap stand-in for stemming of Polish noun endings; it over-matches short stems. Confidence low (no source evaluates it for Polish).
- Trigram tolerance covers typos and many inflected endings without language data (section 2.3). Confidence medium for Polish specifically — no opened source measures it.

### 3.5 Lemmatiser in the application
- Morfeusz 2 is "a morphological analyser and lemmatiser for Polish", a native library with bindings for "C/C++, Java, Perl, Python", dictionary-based ("not equipped with a module that guesses unknown words"); data variants SGJP and Polimorf (the latter merging SGJP with Morfologik/sjp.pl data) — https://morfeusz.sgjp.pl/doc/about/en — confidence high. Licence terms were not opened — unconfirmed.
- Pattern (inference): lemmatise in Python on write and store lemmas in a plain column feeding the `tsvector`; the same function must process wants. Keeps PostgreSQL stock but adds a native dependency and ambiguity handling (one form, several lemmas). Confidence medium.
- Other lemmatisers (spaCy Polish models, Stempel, simplemma) appeared only in search results and were not opened — unconfirmed.

### 3.6 Small embedding models with pgvector (optional path)
- `intfloat/multilingual-e5-small`: "12 layers and the embedding size is 384"; supports the 100 languages of XLM-RoBERTa with a warning that "low-resource languages may see performance degradation"; inputs need a `query: ` or `passage: ` prefix; text is truncated to 512 tokens — https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md — confidence high. Licence not seen in the part read — unconfirmed.
- `sdadas/mmlw-retrieval-e5-small`: Polish retrieval encoder distilled from multilingual E5 on about 60 million Polish–English pairs and fine-tuned on Polish MS MARCO; 384 dimensions; same prefixes; 52.34 NDCG@10 on the Polish Information Retrieval Benchmark; Apache-2.0; about 0.1B parameters — https://huggingface.co/sdadas/mmlw-retrieval-e5-small — confidence high.
- PIRB paper abstract: evaluates "over 20 dense and sparse retrieval models" for Polish and reports that "the use of hybrid methods further improves their performance" — https://arxiv.org/abs/2402.13350 — confidence high. A comparison figure of 50.65 NDCG@10 for multilingual-e5-small came from a search snippet of a paper not opened — unconfirmed.
- pgvector: "By default, pgvector performs exact nearest neighbor search, which provides perfect recall"; HNSW and IVFFlat are optional approximate indexes; `<=>` is cosine distance; supports Postgres 13+; with approximate indexes filters apply after the index scan (iterative scans since 0.8.0); hybrid with full-text search via Reciprocal Rank Fusion is suggested — https://github.com/pgvector/pgvector — confidence high.
- Honest cost notes:
  - At thousands of rows the exact scan needs no vector index (from the pgvector statement; confidence high).
  - Extra moving parts: the extension in the database image, a ~0.1B-parameter model in the worker, an embedding per item and per want, re-embedding on text edits and on model change (inference; confidence high).
  - An alert needs a yes/no decision, so a similarity cut-off must be chosen and tuned on real data; no opened source gives a threshold for short Polish listings (inference; confidence medium). Benchmarks above measure passage retrieval, not three-word wanted posts.
  - CPU inference time and memory under ONNX — unconfirmed.

---

## 4. Trigger timing

- **On new item (reverse)**: the percolator use case — "spot new documents of interest" as they arrive; Funda's matcher "listens for new house listing events" (sections 1.2, 1.4). Confidence high.
- **On new want (forward, backfill)**: the first run of a saved criterion returns many items that are new to the seeker but not new on the platform. One practitioner post weighs "silently mark everything as seen" against treating them as initial matches and defaults to one capped summary ("23 listings currently match - here are the 5 most recent") — https://happyendpoint-website-new.pages.dev/blog/building-property-alerts-app-propertyfinder-api (2026-04-28) — confidence medium (single vendor blog; the reasoning is general).
- **Both** are needed for a complete feature; they differ in volume and therefore in notification shape: the new-item direction yields single matches over time, the new-want direction yields a batch at once (synthesis of the above; confidence medium).
- **Asynchronous, not in the request**: AWS recommends a buffer between ingestion and percolation so matching can be batched to fit workload; Funda runs matching in a separate background service on its own cluster because latency matters less there; the polling post says "Don't send notifications synchronously from the poll loop" and writes one event per new listing to an outbox. Confidence high (three independent sources agree).
- **Periodic batch as an alternative**: scheduled queries fit when several documents must be considered together and real time is not required (Elastic, section 1.2). For wants it trades delay for simplicity and is the natural home for digests and expiry (inference; confidence medium).
- **Edits**: Funda treats an edited saved search as a new one with a new id, so old matches stop counting (section 1.4). For a want this is one way to decide whether an edit re-triggers matching. Confidence medium (one source). Item-side events that should re-trigger matching (re-listing, reservation released, text edited) were found in no opened source — gap.

---

## 5. Match deduplication and idempotency

- **Outbox delivers at least once**: "The Message relay might publish a message more than once"; consumers must be idempotent, for instance by tracking processed message ids — https://microservices.io/patterns/data/transactional-outbox.html — confidence high.
- **Unique key as the guard**: "`ON CONFLICT DO NOTHING` simply avoids inserting a row as its alternative action"; a conflict target can infer partial unique indexes via an index predicate; `RETURNING` covers "each row actually inserted", so skipped pairs return nothing — https://www.postgresql.org/docs/18/sql-insert.html — confidence high. Pattern: unique (want_id, item_id); notify only for returned rows. The page states the atomic-outcome guarantee explicitly for `DO UPDATE`, not for `DO NOTHING`.
- **Seen-set per criterion** in practice: the polling post keeps seen listing ids per saved search and advises "Use the listing ID, not a URL hash - IDs are stable" — section 4 source — confidence medium.
- **Stored matches as the source for digests**: Funda stores matches and builds the daily email from them rather than from live queries (section 1.4) — confidence high. A match table therefore serves three purposes: deduplication, a "matches for this want" list, and digest input.
- **Duplicate filtering at the notification layer too**: LinkedIn's notification gateway drops a notification when "A duplicate notification is being processed" and discards already-handled requests after a restart — https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin — confidence high.
- **Ranking of matches**: `ts_rank` with weight classes A–D (defaults `{0.1, 0.2, 0.4, 1.0}`) and normalisation flags is available for ordering several matches inside one summary — https://www.postgresql.org/docs/18/textsearch-controls.html — confidence high. No opened source addresses ranking wants against each other for the item owner's side — gap.

---

## Sources opened (2026-11-14)

| URL | Used for |
|-----|----------|
| https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-percolate-query.html | Percolator model |
| https://www.elastic.co/blog/when-and-how-to-percolate-1 | When to percolate, scaling |
| https://aws.amazon.com/blogs/big-data/working-with-percolators-in-amazon-opensearch-service | Pre-filtering, buffering |
| https://blog.funda.nl/how-we-enhanced-the-saved-search-feature-with-opensearch/ | Production architecture |
| https://www.stefanwienert.de/blog/2020/11/03/postgresql-reverse-search/ | Stored tsquery pattern |
| https://www.postgresql.org/docs/18/textsearch-intro.html | `@@` forms |
| https://www.postgresql.org/docs/18/functions-textsearch.html | Operators and functions |
| https://www.postgresql.org/docs/18/textsearch-features.html | `querytree`, stored tsquery, configuration warning |
| https://www.postgresql.org/docs/18/textsearch-indexes.html | GIN/GiST column types, lossiness |
| https://www.postgresql.org/docs/18/gist.html | `tsquery_ops` operators |
| https://www.postgresql.org/docs/18/gin.html | GIN operator classes |
| https://www.postgresql.org/docs/18/datatype-textsearch.html | Prefix matching, normalisation |
| https://www.postgresql.org/docs/18/textsearch-controls.html | Ranking |
| https://www.postgresql.org/docs/18/textsearch-dictionaries.html | Ispell, Snowball, ordering |
| https://www.postgresql.org/docs/18/pgtrgm.html | Trigram functions and indexes |
| https://www.postgresql.org/docs/18/unaccent.html | Filtering dictionary |
| https://www.postgresql.org/docs/18/ddl-generated-columns.html | Immutability rule |
| https://www.postgresql.org/docs/18/sql-insert.html | `ON CONFLICT` |
| https://www.postgresql.org/docs/19/release-19.html | Polish stemmer, locale change |
| https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/snowball/Makefile | No Polish in 18 |
| https://raw.githubusercontent.com/postgres/postgres/master/src/backend/snowball/Makefile | Polish in development branch |
| https://snowballstem.org/algorithms/ and https://snowballstem.org/algorithms/polish/stemmer.html | Stemmer description |
| https://www.depesz.com/?p=4454 | Polish configuration recipe on 18, built-in on 19 |
| https://github.com/postgrespro/shared_ispell | Per-session dictionary cost |
| https://www.postgresql.org/message-id/15251.1258645873%40sss.pgh.pa.us | 2009 Polish ispell profiling |
| https://morfeusz.sgjp.pl/doc/about/en | Lemmatiser |
| https://huggingface.co/intfloat/multilingual-e5-small/raw/main/README.md | Embedding model facts |
| https://huggingface.co/sdadas/mmlw-retrieval-e5-small | Polish embedding model |
| https://arxiv.org/abs/2402.13350 | Polish retrieval benchmark |
| https://github.com/pgvector/pgvector | Vector search |
| https://happyendpoint-website-new.pages.dev/blog/building-property-alerts-app-propertyfinder-api | Polling, seen set, first run |
| https://microservices.io/patterns/data/transactional-outbox.html | Outbox, idempotent consumer |
| https://www.linkedin.com/blog/engineering/messaging-notifications/air-traffic-controller-member-first-notifications-at-linkedin | Duplicate filtering |

Could not open: https://www.postgresql.org/docs/18/release-18.html (connection error, twice), https://www.postgresql.org/docs/18/gist-builtin-opclasses.html (404; the table now lives in `gist.html`), https://www.postgresql.org/message-id/9869.1258516286%40sss.pgh.pa.us (connection error).
