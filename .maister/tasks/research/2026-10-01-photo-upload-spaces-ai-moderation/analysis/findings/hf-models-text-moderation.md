# HF Models: Polish Text Moderation (item name and description)

Category: `hf-models` | Access date for all sources: **2026-10-01**
Method: metadata from the HF Hub API (`https://huggingface.co/api/models/<id>`, which gives `lastModified`, `safetensors.total` params, license tag and gating), plus the model cards (raw README or rendered page for gated models) and linked papers.
"Last update" means the HF repo's `lastModified`. It does not necessarily mean the weights changed.

## Summary table

| # | HF model ID | Type | Params | License | Polish? | Labels | Reported accuracy | Last update |
|---|---|---|---|---|---|---|---|---|
| 1 | `speakleash/Bielik-Guard-0.1B-v1.1` | Classifier (RoBERTa, multi-label) | 124 M | Apache-2.0 (gated: auto-approve) | **Native, PL only** | HATE, VULGAR, SEX, CRIME, SELF-HARM | F1 micro 0.775; precision 77.65 %, FPR 0.63 % on 3 000 real prompts | 2026-02-12 |
| 2 | `speakleash/Bielik-Guard-0.5B-v1.1` | Classifier (polish-roberta-8k) | 443 M | Apache-2.0 (gated: auto) | **Native, PL only** | same 5 | F1 micro 0.791; precision 75.28 %, FPR 0.73 % | 2026-06-26 |
| 3 | `NASK-PIB/HerBERT-PL-Guard` | Classifier (HerBERT-base) | 124 M | **CC BY-NC-SA 4.0 (non-commercial)**, gated | Native PL | safe + S1–S14 (Llama Guard taxonomy) | No numbers on the card. Paper (arXiv 2506.16322): best on PL-Guard. Bielik paper: precision 31.55 %, FPR 4.70 % on real prompts | 2025-06-23 |
| 4 | `Qwen/Qwen3Guard-Gen-0.6B` | Guard LLM (generative) | 0.75 B | Apache-2.0 (open) | 119 languages, PL among them; no PL-specific number | Safe / Controversial / Unsafe + Violent, Non-violent Illegal Acts, Sexual Content, PII, Suicide & Self-Harm, Unethical Acts, Politically Sensitive, Copyright, Jailbreak | RTP-LX multilingual avg F1 74.8 (strict); PolyGuard response 74.2 | 2025-11-07 |
| 5 | `Qwen/Qwen3Guard-Gen-4B` / `-8B` | Guard LLM | 4.4 B / 8.2 B | Apache-2.0 | as above | as above | RTP-LX avg F1 81.6 (4B) / 85.0 (8B) | 2025-11-07 |
| 6 | `ToxicityPrompts/PolyGuard-Qwen-Smol` (also `PolyGuard-Qwen` 7.6 B, `PolyGuard-Ministral` 8 B) | Guard LLM | 0.49 B | CC BY-4.0 | **pl listed explicitly** (17 languages, PolyGuardMix training data contains PL) | prompt-harmful / response-harmful / refusal + S1–S14 | Paper claims it beats SOTA open and commercial classifiers by 5.5 % (aggregate) | 2025-06-23 |
| 7 | `meta-llama/Llama-Guard-3-1B` | Guard LLM | 1.5 B (incl. embeddings) | Llama 3.2 Community (gated, manual) | **No.** 8 languages: en, fr, de, hi, it, pt, es, th | S1–S13 | EN F1 0.899 / FPR 0.090; DE 0.835 | 2024-09-26 |
| 8 | `meta-llama/Llama-Guard-3-8B` | Guard LLM | 8.0 B | Llama 3.1 Community (gated) | **No** (same 8) | S1–S14 | Bielik paper on Polish real prompts: **precision 13.62 %, FPR 9.30 %** | 2024-10-11 |
| 9 | `meta-llama/Llama-Guard-4-12B` | Multimodal guard (text+image) | 12 B | Llama 4 Community (gated) | **No** (en + fr, de, hi, it, pt, es, th) | S1–S14 | EN recall 69 %, FPR 11 %, F1 61 %; multilingual F1 51 %; multi-image F1 52 % | 2025-04-29 |
| 10 | `google/shieldgemma-2b` (also 9b, 27b) | Guard LLM | 2.6 B | Gemma terms (gated) | **No, English only** | Hate Speech, Harassment, Dangerous Content, Sexually Explicit | OpenAI Mod F1 0.812; ToxicChat F1 0.704 | 2024-08-28 |
| 11 | `textdetox/xlmr-large-toxicity-classifier-v2` | Classifier (XLM-R large, binary) | 560 M | OpenRAIL++ | **No PL in training/eval** (15 languages: en, ru, uk, de, es, ar, am, hi, zh, it, fr, hin, he, ja, tt) | neutral / toxic | F1 by language 0.56–0.97 (de 0.73, uk 0.96, ru 0.95) | 2025-12-08 |
| 12 | `textdetox/bert-multilingual-toxicity-classifier` | Classifier (mBERT) | 178 M | OpenRAIL++ | No PL | neutral / toxic | de 0.52, uk 0.95 | 2025-12-08 |
| 13 | `textdetox/xlmr-large-toxicity-classifier` (v1) | Classifier | 278 M (as reported by the API) | OpenRAIL++ | No PL (9 languages) | neutral / toxic | all-lang F1 0.871 | 2025-03-20 (superseded by v2) |
| 14 | `unitary/multilingual-toxic-xlm-roberta` (Detoxify `multilingual`) | Classifier (XLM-R base) | ~278 M | Apache-2.0 | **No.** Card: "should only be tested on en, fr, es, it, pt, tr, ru" | toxicity (eval); trained heads incl. obscene, threat, insult, identity_attack, sexual_explicit | Jigsaw multilingual AUC 0.91655 (validation) | 2023-08-18 (card warns HF weights differ from the `detoxify` lib) |
| 15 | `citizenlab/distilbert-base-multilingual-cased-toxicity` | Classifier (distil-mBERT) | ~135 M | **No license tag** | pl in language list (trained on Jigsaw, machine-translated) | toxic / not_toxic | Acc 0.9425, macro F1 0.849 (aggregate, no PL split) | 2022-12-02 |
| 16 | `ptaszynski/bert-base-polish-cyberbullying` | Classifier (Polbert) | ~110 M | CC BY-SA 4.0 (tag says cc-by-4.0) | Native PL (PolEval 2019 Twitter, re-annotated) | cyberbullying binary | No metrics on the card | 2023-12-25 |
| 17 | `dkleczek/Polish-Hate-Speech-Detection-Herbert-Large` | Classifier | ~355 M | **None declared**; empty card | PL | hate | none | 2021-07-16 |
| 18 | `Hate-speech-CNERG/dehatebert-mono-polish` | Classifier (mBERT) | ~178 M | Apache-2.0 | PL (small 2020 dataset) | hate | none useful | 2021-09-25 |

Sources:
- https://huggingface.co/speakleash/Bielik-Guard-0.1B-v1.1
- https://huggingface.co/speakleash/Bielik-Guard-0.5B-v1.1
- Paper: https://arxiv.org/abs/2602.07954 ("Bielik Guard: Efficient Polish Language Safety Classifiers for LLM Content Moderation", Feb 2026)
- https://huggingface.co/NASK-PIB/HerBERT-PL-Guard
- Paper: https://arxiv.org/abs/2506.16322 (PL-Guard, Krasnodębska et al., SlavicNLP workshop)
- https://huggingface.co/Qwen/Qwen3Guard-Gen-0.6B
- Report: https://arxiv.org/html/2510.14276v1
- https://huggingface.co/ToxicityPrompts/PolyGuard-Qwen-Smol
- https://huggingface.co/meta-llama/Llama-Guard-3-1B
- https://huggingface.co/meta-llama/Llama-Guard-3-8B
- https://huggingface.co/meta-llama/Llama-Guard-4-12B
- https://huggingface.co/google/shieldgemma-2b
- https://huggingface.co/textdetox/xlmr-large-toxicity-classifier-v2
- https://huggingface.co/textdetox/bert-multilingual-toxicity-classifier
- https://huggingface.co/unitary/multilingual-toxic-xlm-roberta
- https://huggingface.co/citizenlab/distilbert-base-multilingual-cased-toxicity
- https://huggingface.co/ptaszynski/bert-base-polish-cyberbullying
- https://huggingface.co/dkleczek/Polish-Hate-Speech-Detection-Herbert-Large
- https://huggingface.co/Hate-speech-CNERG/dehatebert-mono-polish

---

## Details per model

### 1–2. Bielik Guard ("Sójka"), SpeakLeash (Polish open-LLM community)
- **Base models**: 0.1B uses `sdadas/mmlw-roberta-base`, 0.5B uses `PKOBP/polish-roberta-8k`, which has a 128 k vocabulary and an 8 k context.
- **Task**: multi-label `text-classification` with a sigmoid score from 0 to 1 per category. The overall risk is the max over the categories. The model works with the standard `transformers` `pipeline("text-classification", ..., top_k=None)`.
- **Training data**: Sojka2, 6 885 unique Polish texts with 60 000+ ratings from 1 500+ volunteers (7–8 per text). The labels are soft, based on the share of annotators.
- **Per-category F1** on the Sojka test set:
  - 0.1B: SELF-HARM 0.886, SEX 0.889, VULGAR 0.742, CRIME 0.707, HATE 0.628
  - 0.5B: SELF-HARM 0.879, SEX 0.915, VULGAR 0.750, CRIME 0.716, HATE 0.667
  - ROC AUC for the 0.5B is 0.93–0.99.
- **Real-traffic comparison**: on 3 000 real user prompts, the card reports precision / alert rate / FPR.
  - Bielik 0.1B v1.1: 77.65 % / 2.83 % / 0.63 %
  - Bielik 0.5B v1.1: 75.28 % / 2.97 % / 0.73 %
  - HerBERT-PL-Guard: 31.55 % / 6.87 % / 4.70 %
  - Llama-Guard-3-8B: 13.62 % / 10.77 % / 9.30 %
  - The Bielik paper also reports Qwen3Guard at about 11 % precision. Confidence for that figure is medium: it comes from the card's summary.
- **v1.0 → v1.1**: only the thresholds were recalibrated. Precision went from 67.27 % to 77.65 % and FPR from 1.20 % to 0.63 % (0.1B).
- **Limitations stated by the authors**: Polish only. The models don't detect disinformation or jailbreaks. CRIME has the weakest performance. The authors intended the models for LLM prompt/response moderation, not for marketplace listings.
- **Gaps for this app**: there is **no spam, scam or PII category**, and no "contact info" label.
- **Inference cost**: a 124 M encoder runs in tens of ms on CPU (inferred from architecture class, not measured). ONNX/int8 export with Optimum is standard for RoBERTa.
- **Gating**: "auto". You must accept the terms on HF and use an HF token to download. Approval is automatic.
- **Confidence**: High (card + paper agree).

### 3. NASK-PIB/HerBERT-PL-Guard
- NASK is the Polish national research institute. The model is HerBERT-base-cased trained on PL-Guard + PolyGuardMix + WildGuardMix, and outputs `safe` plus the 14 Llama-Guard hazard categories.
- **License is CC BY-NC-SA 4.0 (non-commercial)**. That blocks use in a commercial product.
- Its high FPR on real prompts (4.70 %) makes it a poor choice next to Bielik Guard.
- **Confidence**: High on license; Medium on accuracy (comes from a competitor's paper).

### Note: newer Polish work
"Baszta" (arXiv 2609.29266, submitted 2026-09-24, Billennium) is a HerBERT-base, 124 M, five-category model with the same taxonomy as Bielik. It claims a small micro-F1 lead over Bielik Guard. The paper doesn't give an HF ID or license (checked 2026-10-01). Revisit it later; don't adopt it yet.

There are also community re-trains of Bielik Guard, such as `Fibogacci/muszka-guard-0.1b-v1.1`. These are not evaluated here.

### 4–5. Qwen3Guard-Gen (Alibaba Qwen)
- This is a generative guard. It outputs text such as `Safety: Unsafe\nCategories: Violent`, which you parse with regex, as in the card's example. It needs `transformers>=4.51` and `generate()`, so it is LLM-shaped, not a simple classifier head.
- It has three tiers: Safe, **Controversial** ("harmfulness may be context-dependent") and Unsafe. The middle tier maps cleanly to a "send to human review" state.
- It is the **only guard LLM in this list with a PII category**, which is relevant to contact-info leakage.
- The model supports 119 languages, Polish among them, but the technical report puts Polish in an aggregated "Others" bucket. There is **no Polish-specific score**.
- Bielik's real-traffic evaluation suggests poor precision on Polish (around 11 %). Treat this as medium confidence.
- `Qwen/Qwen3Guard-Stream-0.6B` (updated 2026-09-27) is a token-level streaming variant meant for LLM output streams. It is not relevant for static listings.
- **Size**: 0.6 B can run on CPU, at roughly hundreds of ms to seconds per item. 4 B and 8 B practically need a GPU.

### 6. PolyGuard (ToxicityPrompts, CMU et al.)
- The card lists **pl explicitly** among its 17 languages. The PolyGuardMix training set has 1.91 M samples, and PolyGuardPrompts is a 29 K-sample benchmark.
- It is a generative model designed for human-LLM interactions, with a prompt + response template. To use it on a listing, you would pass the listing text as the "user prompt".
- **License**: CC BY-4.0. The base models' licenses also apply: Qwen2.5 (Apache) and Ministral (Mistral Research License, which is restrictive). Check `PolyGuard-Ministral` before any commercial use.
- **Confidence**: Medium. Polish support is declared, but the card has no Polish-only metric.

### 7–9. Llama Guard 3 / 4 (Meta)
- **None of them list Polish.** Llama Guard 4's multilingual F1 (51 %) is already low for its supported languages.
- The Bielik paper measured Llama-Guard-3-8B on Polish prompts at 13.6 % precision and 9.3 % FPR. That would flag about 1 in 10 innocent listings.
- They are gated with manual approval and have custom community licenses.
- They are **LLM-sized**: 1 B–12 B parameters, and the 8 B/12 B models need a GPU.
- **Verdict**: not recommended for Polish text.

### 10. ShieldGemma (text, Google)
- English only. The model is gated under Gemma terms and needs a policy prompt.
- **Verdict**: not suitable for Polish text.

### 11–14. Multilingual XLM-R toxicity (textdetox, Detoxify)
- **Polish was never in the training or evaluation languages.** Any Polish ability is cross-lingual transfer from XLM-R pre-training and is unmeasured.
- Even for neighbouring languages in-set, German F1 is only 0.52–0.73.
- These models output binary toxicity only, with no sexual/spam/PII split. The exception is Detoxify's extra heads, which are trained on English Jigsaw data.
- The Detoxify card warns that the HF weights give different results from the `detoxify` pip library.
- OpenRAIL++ allows commercial use with use-based restrictions.
- **Verdict**: useful only as a second-opinion ensemble member. Not a primary model for Polish.

### 15–18. Older Polish or "pl-tagged" classifiers
- `citizenlab/...-toxicity`: Jigsaw translated into several languages, no license declared, last update 2022. Avoid it because of the missing license.
- `ptaszynski/bert-base-polish-cyberbullying`: trained on Polish Twitter cyberbullying (PolEval 2019). The domain is harassment between users, not listings.
- `dkleczek/...Herbert-Large` and `dehatebert-mono-polish`: 2021, no metrics, no or unclear license. Abandoned.

---

## Spam / scam detection: no usable Polish model on HF
- Hub search `spam&language=pl` returned only English SMS/e-mail spam models (`mrm8488/bert-tiny-finetuned-sms-spam-detection`, `mshenoda/roberta-spam`, ...) and Russian or German ones. Search date: 2026-10-01, URL `https://huggingface.co/api/models?search=spam&language=pl`.
- `baptistejamin/xlm-roberta-large-spam_v4` (560 M, updated 2025-11-19) is multilingual XLM-R, but it has **no license, no card metrics and only 373 downloads**. It is not production-grade.
- **Finding**: listing spam and scams ("zarób w domu", links to external shops, crypto, "napisz na WhatsApp", reposting the same item 20 times) is better handled by:
  1. rules: URL, phone and e-mail regex, a blocklist of domains and keywords, and a rate limit;
  2. a duplicate or near-duplicate check, for example embedding similarity or simple hashing per user;
  3. optionally, a zero-shot or instruction model (Qwen3Guard's "Non-violent Illegal Acts / Unethical Acts", or a small LLM prompt) for flagging into human review.
- **Confidence**: High on the absence of a Polish spam model. The recommendation is inferred.

## PII / contact-info detection (Polish)

| HF model ID | Params | License | PL | Entities | Accuracy | Last update |
|---|---|---|---|---|---|---|
| `bardsai/eu-pii-anonimization-multilang` | 278 M (XLM-R base) | Apache-2.0 | **Yes**, all 24 EU languages; the card says PL performance is "comparable to the English baseline". It has Polish widget examples (PESEL, address) | 36 BIO classes: names, DOB, national IDs (PESEL), addresses, **emails, phone numbers**, IBAN, cards, IP, usernames, GDPR Art. 9 categories | No numeric metrics on the card | 2026-05-13 |
| `ArkadiuszPawlak/fastpdn-ner-polish-pii` | ~110 M (clarin-pl/FastPDN) | CC BY-4.0 | Native PL | PERSON, PERSON_F/L, STREET, CITY, ORG (**no phone or e-mail**; house numbers are left to regex) | Overall F1 96.0 % (fp32), 95.4 % (int8), on a test set that is mostly synthetic | 2026-06-18 |
| `urchade/gliner_multi_pii-v1` | ~290 M (mDeBERTa GLiNER) | Apache-2.0 | Not listed (en, fr, de, es, pt, it); multilingual backbone | Open-vocabulary: phone number, email, address, ... | No metrics | 2024-04-20 |

- bards.ai is a Polish company. It ships ONNX and INT8 weights in `onnx/model_quantized.onnx` for CPU inference.
- **For this app, phone numbers and e-mails are better caught by regex than by NER.** Polish numbers look like `+48 123 456 789`, `123-456-789` or `123456789`, and e-mails follow a fixed pattern. Regex is deterministic and explainable, which helps with a DSA statement of reasons.
- Obfuscated forms like "pięć zero jeden...", "jan kropka kowalski małpa gmail" or "tel. w priv" are the edge case where an ML model (NER or an LLM) adds value.
- Presidio is already used in the `ai-description` plugin through LiteLLM (per sources.md). It can host the bardsai model as a custom recognizer next to regex recognizers.

Sources:
- https://huggingface.co/bardsai/eu-pii-anonimization-multilang
- https://huggingface.co/ArkadiuszPawlak/fastpdn-ner-polish-pii
- https://huggingface.co/urchade/gliner_multi_pii-v1
- https://huggingface.co/api/models?search=spam&language=pl

## Classifier-sized vs LLM-sized (text)

| Class | Models | CPU-only feasible? | Polish quality |
|---|---|---|---|
| Classifier, ≤ 0.5 B, encoder | Bielik-Guard 0.1B / 0.5B, HerBERT-PL-Guard, textdetox, Detoxify, bardsai PII | Yes: ONNX int8, ~tens of ms | Bielik: measured, good. Others: unmeasured or poor |
| Small guard LLM, 0.5–1.5 B | Qwen3Guard-Gen-0.6B, PolyGuard-Qwen-Smol, Llama-Guard-3-1B | Possible, but slower (generation) | Declared multilingual. PL not separately measured. Llama Guard has no PL |
| Large guard LLM, 4–12 B | Qwen3Guard-Gen-4B/8B, PolyGuard 7–8B, Llama Guard 3-8B / 4-12B, ShieldGemma 2B+ | GPU needed | Llama Guard 3-8B measured poor on PL (13.6 % precision) |
