# Research Brief

## Question (user, Polish)
"Chcę dodać galerię zdjęć, ale uploadować do DigitalOcean Spaces. Chcę również podejść do moderacji nazwy, opisu oraz zdjęcia dodawanych do systemu — chcę wykorzystać modele AI z Hugging Face. Czy taki model do moderacji ma się znaleźć w osobnym mikroserwisie?"

## Research type
Mixed (technical codebase integration + literature/best practices + architecture decision).

## Sub-questions
1. **Photo upload to DigitalOcean Spaces**: how to replace today's URL-only product gallery (`product_photos`, `/api/products/{id}/photos`) with real file uploads stored in DO Spaces (S3-compatible). Direct-from-browser presigned upload vs proxy through FastAPI; bucket layout, public vs private + CDN, image processing (resize/thumbnails/EXIF strip), size/type limits, cleanup of orphans, config/secrets, local dev (MinIO?), cost.
2. **AI moderation of name, description and photos** using Hugging Face models: which models for Polish text toxicity/spam/PII and for image NSFW/violence; hosted (HF Inference API / Inference Endpoints) vs self-hosted (transformers / ONNX / TEI); latency, cost, accuracy for Polish; sync vs async moderation flow (pending → approved/rejected), human review, false positives, appeals, audit.
3. **Architecture**: should moderation be a separate microservice (vs in-process module in the FastAPI monolith/microkernel, vs managed API, vs worker via existing outbox)? Trade-offs for this project's scale (pre-production, small team, plugin-based microkernel with Next.js plugins like `ai-description`).

## Scope
- Included: current codebase (product photos, plugin system, outbox/notifications, auth, deployment/config), DO Spaces S3 API, HF models & hosting options, moderation workflow patterns, architecture options.
- Excluded: implementation; non-DO storage vendors except as comparison; payments.
- Constraints: Python 3.12+/FastAPI/async SQLAlchemy/PostgreSQL backend, React frontend, pre-production, Polish-language content, minimal dependencies standard.

## Success criteria
- Concrete recommended upload flow + data model changes for DO Spaces.
- Shortlist of HF models (text PL + image) with hosting recommendation and cost/latency notes.
- Clear answer with trade-offs: separate microservice or not, and when to split.
