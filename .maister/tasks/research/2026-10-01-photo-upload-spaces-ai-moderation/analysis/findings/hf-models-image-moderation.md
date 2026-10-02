# HF Models: Image Moderation (NSFW, violence/gore, weapons)

Category: `hf-models` | Access date: **2026-10-01**
Method: metadata from the HF Hub API, which gives `lastModified`, param count, license and gating, plus the model cards.
Language is not applicable for pure image classifiers. For vision guard LLMs, the policy prompt language matters, so it is noted.

## Summary table

| # | HF model ID | Type | Params | License | Labels | Reported accuracy | Last update |
|---|---|---|---|---|---|---|---|
| 1 | `Falconsai/nsfw_image_detection` | ViT-base/16 224 classifier | 85.8 M | Apache-2.0 | `normal`, `nsfw` | eval accuracy 0.9804 (proprietary 80 k image set) | 2026-09-07 |
| 2 | `AdamCodd/vit-base-nsfw-detector` | ViT-base/16 384 classifier | 86.1 M | Apache-2.0 | `sfw`, `nsfw` | acc 0.9654, AUC 0.9948 (≈25 k images); on generative images acc 0.86 | 2024-12-03 |
| 3 | `Marqo/nsfw-image-detection-384` | ViT-tiny/16 384 (timm) | **5.6 M** | Apache-2.0 | NSFW / SFW | acc 98.56 % on own 20 k test set (220 k image training set incl. drawings, memes, AI images) | 2024-11-27 |
| 4 | `Freepik/nsfw_image_detector` | EVA02-base 448 | 86.4 M | **MIT** | `neutral`, `low`, `medium`, `high` (graded) | Own benchmark: high 99.54 %, medium 97.02 %, low 98.31 %, neutral 99.87 % (vs Falconsai 97.92 / 78.54 / **31.25** / 99.27) | 2025-05-09 |
| 5 | `google/shieldgemma-2-4b-it` | Vision guard LLM (Gemma 3 4B) | 4.3 B | Gemma terms (gated, manual) | 3 policies: Sexually Explicit, Dangerous Content, Violence/Gore; returns P(Yes) | P/R/F1: Sexual 87.6/89.7/88.6; Dangerous 95.6/91.9/93.7; Violence & Gore 80.3/90.4/85.0 | 2025-04-04 |
| 6 | `meta-llama/Llama-Guard-4-12B` | Multimodal guard (text + up to a few images) | 12 B | Llama 4 Community (gated) | S1–S14 (incl. S1 Violent Crimes, S9 Indiscriminate Weapons, S12 Sexual Content, S4 Child Sexual Exploitation) | Multi-image: recall 61 %, FPR 9 %, F1 52 % | 2025-04-29 |
| 7 | `meta-llama/Llama-Guard-3-11B-Vision` | Multimodal guard | 10.7 B | Llama 3.2 Community (gated) | S1–S13 | superseded by LG4 | 2024-11-18 |
| 8 | `jaranohaal/vit-base-violence-detection` | ViT-base 224 | 85.8 M | Apache-2.0 | violence / non-violence | test acc 98.80 %, but **trained on "Real Life Violence Situations" (video frames of fights)** | 2025-05-09 |
| 9 | `openai/clip-vit-base-patch32` / `openai/clip-vit-large-patch14`; `google/siglip2-base-patch16-224` | Zero-shot image–text | 151 M / 428 M; 375 M | CLIP: MIT on GitHub (no HF tag); SigLIP2: Apache-2.0 | Any text prompts ("a photo of a gun", "a toy gun", "a knife", "blood") | No moderation benchmark; quality depends on prompts | 2024-02-29 / 2023-09-15; 2025-02-21 |

Sources:
- https://huggingface.co/Falconsai/nsfw_image_detection
- https://huggingface.co/AdamCodd/vit-base-nsfw-detector
- https://huggingface.co/Marqo/nsfw-image-detection-384
- https://huggingface.co/Freepik/nsfw_image_detector
- https://huggingface.co/google/shieldgemma-2-4b-it
- https://huggingface.co/meta-llama/Llama-Guard-4-12B
- https://huggingface.co/meta-llama/Llama-Guard-3-11B-Vision
- https://huggingface.co/jaranohaal/vit-base-violence-detection
- https://huggingface.co/openai/clip-vit-large-patch14
- https://huggingface.co/google/siglip2-base-patch16-224

---

## Details

### 1. Falconsai/nsfw_image_detection
- This is the most downloaded NSFW model on the Hub, with about 2.18 M downloads per month according to the API on 2026-10-01. It is a plain binary ViT.
- The card also ships a YOLOv9 ONNX variant.
- **Weaknesses**, all measured by other vendors (Freepik and Marqo), so medium confidence:
  - Weak on borderline content: Freepik's "low" class gets 31 % accuracy.
  - Weak on AI-generated images: 84 % on "high".
- Its 98 % accuracy comes from a proprietary dataset, and the class definition is not documented.
- **Fit**: a good, cheap first filter for explicit nudity. It is less sensitive to "skin" than AdamCodd's model, which **lowers false positives on kids' swimwear and underwear photos**. The flip side is that it misses suggestive content.

### 2. AdamCodd/vit-base-nsfw-detector
- The card says: "trained to be restrictive and therefore classify 'sexy' images as NSFW ... cleavage or too much skin". For a children's-clothing marketplace, that means **swimsuits, bodysuits, underwear and breastfeeding bras** are likely to be flagged. Expect a high false-positive rate.
- It has an official Transformers.js usage path, so it could run in the browser as a pre-check.

### 3. Marqo/nsfw-image-detection-384
- 5.6 M parameters, which the card describes as "18–20x smaller" than the others. It is a timm model, not a `transformers` pipeline.
- The card publishes threshold, precision and recall curves, which is useful for threshold tuning.
- It is very cheap on CPU, so it can run synchronously in the upload request.

### 4. Freepik/nsfw_image_detector
- It outputs 4 graded levels. This maps well to a policy of auto-reject `high`, human-review `medium`/`low`, and auto-approve `neutral`.
- Freepik published latency on GPU in bf16: 28 ms per image at batch 1 with PIL input, and 540 MB VRAM. CPU latency is not published. EVA02 at 448 px is heavier than ViT-224 on CPU (inferred).
- It has a pip package, `nsfw-image-detector`, and the card claims the best accuracy against Falconsai and AdamCodd on Freepik's own benchmark. The source is the vendor itself, so confidence is medium.
- MIT licensed.

### 5. ShieldGemma 2 (google/shieldgemma-2-4b-it)
- This is the **only open model in this list covering all three requested image harms** (sexual, violence/gore, dangerous content, which includes weapons) with published per-policy precision and recall.
- The policy prompts are in English, but that doesn't matter for images.
- It is gated (Gemma terms), 4.3 B parameters, and realistically needs a GPU (inferred: about 9 GB in bf16).
- The card warns it is "highly sensitive to the specific user-provided description of safety principles".

### 6. Llama Guard 4 (multimodal)
- It handles text and images in one call, which could moderate a whole listing (name + description + photos) at once.
- But it has **no Polish support** for the text side, its multi-image F1 is 52 %, it has 12 B parameters (needs a GPU) and it is gated.
- **Verdict**: not recommended for this app.

### 8. Violence classifier
- `jaranohaal/vit-base-violence-detection` is trained on frames from CCTV-style fight videos. It detects "people fighting", not gore or weapons in product photos.
- **Verdict**: poor domain fit. There is no well-maintained open "gore" or "weapon" image classifier on the Hub. The `weapon` search for image-classification returns CS:GO game weapon classifiers and small object-detection experiments with fewer than 200 downloads.

### 9. CLIP / SigLIP zero-shot
- This is a flexible way to add app-specific categories without training: weapons, knives, drugs, alcohol, cigarettes, "not a children's product", or "photo of a screen with text/phone number".
- Thresholds need calibration on a small labelled set, and there is no published moderation accuracy.
- SigLIP2 is Apache-2.0 and more recent. The CLIP weights have no license tag on HF (MIT per OpenAI's GitHub repo).

## Classifier-sized vs LLM-sized (image)

| Class | Models | CPU feasible | Coverage |
|---|---|---|---|
| Tiny / base classifiers | Marqo (5.6 M), Falconsai, AdamCodd, Freepik (86 M) | Yes | **Sexual only** |
| Zero-shot embedding | CLIP / SigLIP2 (150–430 M) | Yes | Anything you can phrase, but uncalibrated |
| Vision guard LLM | ShieldGemma-2-4B, Llama Guard 4-12B | GPU | Sexual + violence + dangerous/weapons |

## Not covered by HF models: CSAM
For a children's-items platform, child sexual abuse material is the highest-severity risk. Open HF NSFW classifiers are **not** CSAM detectors.

Industry practice is hash matching against known material, for example Microsoft PhotoDNA or Thorn Safer, which are not on HF, together with legal reporting duties.

Llama Guard 4 S4 is a text and multimodal category, not a hash matcher.

This is flagged for the moderation-architecture and synthesis steps. Confidence: High that HF models don't cover it. The industry-practice statement is general knowledge and is not sourced in this file.
