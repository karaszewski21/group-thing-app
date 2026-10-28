# vinted_categories_pl.json: provenance

A one-time snapshot of the vinted.pl category tree, used to seed `categories` (revision 0069). It is a static snapshot: it is not synced with Vinted, and taking it is a one-off manual copy whose ToS standing the project owner accepts at review.

## Source and date
- Snapshot date: 2026-10-27.
- Source: vinted.pl catalog pages `https://www.vinted.pl/catalog` and `https://www.vinted.pl/catalog/{id}-{slug}`, read with an HTML-to-text fetch tool. Each page lists its breadcrumb followed by its direct children in site order; a page that lists only its breadcrumb was taken as a leaf.
- Root pages: Kobiety `/catalog/1904`, Mężczyźni `/catalog/5`, Dzieci `/catalog/1193`, Dom `/catalog/1918`, Elektronika `/catalog/2994`, Książki i multimedia `/catalog/2309`, Hobby i kolekcjonerstwo `/catalog/4824`, Sport `/catalog/4332`, and Zwierzęta `/catalog/5106` (listed on the site under Dom).
- No branch was filled from memory. Every node was seen on a vinted.pl page.

## external_id
- Each `external_id` is the integer in the `/catalog/{id}-…` href the node was seen under. No id was guessed.
- Null ids: 0.

## Deviations from the site (decided by the spec's root list, FR-2)
- The site's "Książki i multimedia" root is stored as **Rozrywka**, and "Hobby i kolekcjonerstwo" as **Hobby i kolekcje** (ids 2309 and 4824 kept).
- **Zwierzęta** (5106) is a child of Dom on the site. It is stored as the last root and removed from Dom.
- Three sibling-name clashes on the site were renamed in Polish (approved by the user on 2026-10-27):
  - Kobiety › Ubrania › Bluzy i swetry: "Bluzy" (1917) and "Bluzy" (196) → 196 is "Bluzy z kapturem".
  - Kobiety › Torby: "Torby podróżne" (1850) and (1849) → "Walizki" (1850) and "Torby podróżne" (1849).
  - Dom › Narzędzia i majsterkowanie › Elektronarzędzia: "Szlifierki" (3901: kątowe, proste, stołowe) and "Szlifierki" (3900: oscylacyjne, mimośrodowe, detaliczne, taśmowe) → 3900 is "Szlifierki do powierzchni".
- The crawl is incomplete (vinted.pl HTTP 429 rate limiting); the user accepted the current depth on 2026-10-27, and the gaps below are to be filled in a later task.
- Site spellings kept as shown, e.g. "Jednocześciowe", "Inne biżuteria", "Etui i etui na czytniki e-booków".

## Counts (depth: root = 1)
| Root | Nodes | Max depth |
|---|---|---|
| Kobiety | 261 | 5 |
| Mężczyźni | 188 | 5 |
| Dzieci | 228 | 5 |
| Dom | 683 | 5 |
| Elektronika | 277 | 4 |
| Rozrywka | 22 | 3 |
| Hobby i kolekcje | 258 | 4 |
| Sport | 301 | 4 |
| Zwierzęta | 68 | 4 |
| **Total** | **2286** | **5** |

## Gaps (incomplete crawl)
vinted.pl rate-limited the fetches (HTTP 429), so many nodes were seen in their parent's child list but their own page was never opened. They are stored with `children: []`, so they may really have children that are missing:
- Kobiety › Ubrania: about 100 of the 115 level-3 pages and all 24 level-4 pages not opened.
- Kobiety › Obuwie/Akcesoria/Torby/Kosmetyki: 39 level-4 pages not opened (a sample of 7 were all leaves).
- Mężczyźni: 13 level-4 pages under Torby, Biżuteria and Akcesoria do pielęgnacji not opened; level-5 pages not opened.
- Dzieci: only Ubrania dla dziewczynek is crawled to depth 4–5; in the other 11 subtrees only the level-2 lists were read (81 nodes not opened).
- Elektronika: Odtwarzacze Blu-ray and all 173 level-4 nodes not opened.
- Rozrywka: all 17 level-3 nodes not opened (the Książki genres most likely have children).
- Hobby i kolekcje: all 191 level-4 nodes (under Plastyka i rękodzieło and Instrumenty i sprzęt muzyczny) not opened.
- Sport: 74 level-3 nodes (Sporty wodne, Deskorolki i hulajnogi, Sporty zespołowe, Boks i sztuki walki, Sporty rakietowe, Gry rekreacyjne, Golf) and 173 level-4 nodes not opened.
- Dom: all level-2 and level-3 lists read. Narzędzia i majsterkowanie and Wyposażenie ogrodowe are crawled to depth 5. The level-4 nodes of Akcesoria i ozdoby, Akcesoria stołowe, Tekstylia, Małe AGD kuchenne, Artykuły biurowe and AGD i akcesoria do sprzątania were not opened.
- Zwierzęta: Psy is complete, and Koty is complete except Pielęgnacja (5160). The 10 level-3 nodes under Małe zwierzęta, Akwarystyka, Gady and Ptaki were not opened.
