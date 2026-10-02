# HF Models: App-Specific Fit and Shortlist

Context: second-hand **children's items** in a **Polish parent community**. Content is short: an item name (a few words) plus a description (1–5 sentences), plus photos of clothes, toys, prams and car seats.
Access date: 2026-10-01. Detailed evidence is in `hf-models-text-moderation.md` and `hf-models-image-moderation.md`.

## 1. What actually goes wrong on a parent marketplace (expected risk profile)

This list is inferred from the domain, not measured.

| Risk | Likelihood | Best detector |
|---|---|---|
| Contact info in descriptions (phone, e-mail, "pisz na FB/WhatsApp"), meant to move the deal off-platform | **High** | Regex first, PII NER second |
| Spam or commercial reselling, external links, repeated posts | Medium | Rules, URL detection, dedup, rate limits |
| Vulgar or abusive text (rare in listings, more common in comments) | Low–Medium | Bielik Guard VULGAR / HATE |
| Sexual text (rare; mostly innocent words that look sexual) | Low | Bielik Guard SEX, with tuned thresholds |
| Prohibited items: weapons, drugs, alcohol, medicines, recalled car seats | Low | Bielik CRIME (weak), Qwen3Guard, CLIP zero-shot, keyword lists |
| Explicit or suggestive photos | Low, but **severe** | NSFW image classifier |
| Photos of children (privacy, faces) | **Medium** (kids modelling clothes) | Not an HF NSFW task; face-detection policy question |
| CSAM | Very low, but catastrophic | Hash matching, not HF models |

## 2. False-positive hotspots specific to this domain

These hotspots are inferred. Each needs confirmation with a small Polish evaluation set built from real listings, about 200–500 items.

**Text**

Normal Polish baby or kids vocabulary that looks sexual or vulgar:
- body / bodziak (baby bodysuit)
- majtki, majteczki (underwear)
- stanik do karmienia, biustonosz (nursing bra)
- laktator (breast pump)
- smoczek (dummy, pacifier)
- nocnik (potty)
- pieluchy (nappies)
- "ssak" brand names
- "goły" (naked, as in "goły materac", a bare mattress)
- "cycek" (colloquial for breast, common in breastfeeding talk)
- "do kąpieli" (for bathing)
- sizes such as "62 cm" or "rozm. 98"

Keyword blocklists and English-trained or translation-trained toxicity models (Detoxify, citizenlab, textdetox) are most at risk here.

Bielik Guard was trained on Polish soft labels with v1.1 calibrated for high precision (FPR 0.63 % on real prompts). It is the least likely to over-flag, but it has **not** been tested on marketplace text.

Weapon-like toys are another hotspot: "pistolet na wodę" (water pistol), "miecz", "Nerf", "łuk" (bow), "karabin zabawka" (toy rifle). Keyword lists and CRIME-style classifiers may fire on them.

**Images**

- Kids in swimsuits or underwear, babies in nappies or bath photos, breastfeeding products: AdamCodd's model is documented as "restrictive ... too much skin = NSFW". Falconsai is less restrictive. Freepik's graded output lets you send only `medium/high` to review.
- Toy guns or swords in photos would trigger a CLIP "weapon" prompt. Mitigate this with contrastive prompts ("a toy gun", "a plastic toy") and human review rather than auto-reject.

**Mitigation pattern**

This pattern feeds into the moderation-architecture findings:
- Use **two thresholds**: auto-approve below a low score, auto-reject above a very high score, and queue everything in between for human review.
- Start in **shadow mode**, logging scores without blocking, to calibrate thresholds on real Polish data before enforcing anything.

## 3. Contact-info detection specifically

**Layer 1: regex**. This is deterministic and explainable. It covers:
- PL phone numbers: `(\+?48[\s-]?)?(\d{3}[\s-]?\d{3}[\s-]?\d{3})`, plus landline formats
- e-mails
- URLs and domains
- messenger handles (`@nick`, "fb.com/...", "wa.me/...")
- keywords: "zadzwoń", "pisz na priv", "whatsapp", "messenger", "telegram"

The upside is no false negatives on canonical formats and easy statements of reason. The downside is that it misses obfuscation.

**Layer 2: PII NER**. `bardsai/eu-pii-anonimization-multilang` (Apache-2.0, 278 M, ONNX int8, PL supported, has phone and email entities) catches person names and addresses, and possibly obfuscated numbers. Its Polish accuracy for obfuscated numbers is **not reported**, so confidence is low.

`ArkadiuszPawlak/fastpdn-ner-polish-pii` (CC BY-4.0) gives native Polish names, streets and cities with F1 96 %, but it has **no phone or e-mail entities**.

**Layer 3: optional LLM**. `Qwen/Qwen3Guard-Gen-0.6B` has a **PII** category and is Apache-2.0. Its Polish precision is unmeasured.

**Policy question for synthesis**: should contact info be blocked, masked, or allowed? In a closed parent group, sharing a phone number may be legitimate. The model choice depends on this product decision.

## 4. Shortlist

### Text (3)

1. **`speakleash/Bielik-Guard-0.1B-v1.1`** (primary). It is the only model with **measured, good Polish performance**: precision 77.65 %, FPR 0.63 % on real Polish traffic. Per-category F1 is 0.63–0.89, and there is a 2026 peer-reviewable paper (arXiv 2602.07954). It is Apache-2.0 and has 124 M params, so it runs on CPU with ONNX/int8. Its five labels (HATE, VULGAR, SEX, CRIME, SELF-HARM) cover the toxic/sexual part of the brief. Upgrade path: `Bielik-Guard-0.5B-v1.1` (443 M) for +0.016 micro-F1, with better HATE and SEX results.
   - Caveat: it does not cover spam or PII, it was built for LLM prompts rather than listings, and you must accept the gate terms (auto-approved).
2. **Regex rules + `bardsai/eu-pii-anonimization-multilang`** for contact info and PII. Apache-2.0, 278 M, ONNX int8 included, all EU languages including Polish, and it has phone, e-mail, address and national-ID entities. Regex does the heavy lifting; the NER catches names, addresses and obfuscated cases.
   - Caveat: it publishes no numeric metrics.
3. **`Qwen/Qwen3Guard-Gen-0.6B`** (optional, second opinion or review triage). Apache-2.0 and not gated, 0.75 B parameters. It is the only small guard LLM with **PII + Non-violent Illegal Acts + a "Controversial" tier**, which suits the "needs human review" bucket and prohibited items such as weapons, drugs and medicines.
   - Caveat: it is generative (slower) and has no Polish-specific score; Bielik's evaluation suggests low precision on Polish. Use it only to route items to review, never to auto-reject.
   - Alternative: `ToxicityPrompts/PolyGuard-Qwen-Smol` (0.49 B, CC BY-4.0) lists Polish explicitly in its training languages.

**Rejected for Polish text**:
- Llama Guard 3/4: no Polish, 13.6 % precision measured on Polish.
- ShieldGemma text: English only.
- textdetox and Detoxify: no Polish in training.
- HerBERT-PL-Guard: non-commercial license, 4.7 % FPR.
- Older Polish hate models: unlicensed or abandoned.

### Image (3)

1. **`Falconsai/nsfw_image_detection`** or **`Freepik/nsfw_image_detector`** (primary NSFW).
   - Falconsai: Apache-2.0, 86 M, the most used, simple `transformers` pipeline, and less skin-sensitive, so fewer false positives on kids' clothing photos.
   - Freepik: MIT, 86 M EVA02, graded neutral/low/medium/high. It is better at borderline content according to the vendor's benchmark, and the grades map directly onto approve/review/reject.
   - Pick Freepik if you want graded routing; pick Falconsai if the simplest CPU path matters most.
   - Avoid AdamCodd as primary, because its card says it is deliberately restrictive on skin.
2. **`Marqo/nsfw-image-detection-384`** (cheap option). Apache-2.0 and only 5.6 M params (timm), with 98.56 % accuracy on its own test set and published threshold and PR curves. It is cheap enough to run synchronously in the upload path on a small CPU droplet.
3. **`google/shieldgemma-2-4b-it`** (when violence/gore and weapons coverage is needed). It is the only open model with published P/R for Sexual (F1 88.6), Dangerous (93.7) and Violence/Gore (85.0). It needs a GPU or a hosted endpoint and is gated under Gemma terms.
   - Use it asynchronously, on items already flagged or on a sample, or replace it with **CLIP/SigLIP2 zero-shot** prompts on CPU if a GPU is not affordable. That is uncalibrated, so send results to review only.

**Rejected for images**:
- Llama Guard 4: 12 B, F1 52 % multi-image, and gated.
- `jaranohaal/vit-base-violence-detection`: CCTV fight frames, a domain mismatch.
- Weapon classifiers on the Hub: game or experimental only.

## 5. Gaps and uncertainties
- **No HF model has been benchmarked on Polish marketplace listings.** All Polish numbers are from chatbot prompt datasets. A small in-house evaluation set is required before thresholds are enforced.
- Qwen3Guard and PolyGuard have no Polish-specific numbers in their reports.
- The bardsai PII card publishes no metrics.
- The Freepik and Marqo comparisons against Falconsai and AdamCodd were run by those vendors on proprietary sets.
- CPU latency figures are not published for most models. Only Freepik gives GPU timings: 28 ms at batch 1. The `hf-hosting` category should measure or source these.
- Baszta (arXiv 2609.29266, Sept 2026), a HerBERT-based Polish five-category guard, may match or beat Bielik Guard. It has no HF ID or license yet; re-check later.
- CSAM requires hash matching, which is outside the HF model scope.
