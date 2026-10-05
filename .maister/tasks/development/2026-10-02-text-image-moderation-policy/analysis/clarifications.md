# Clarifications (Phase 1)

1. **Where sync text moderation runs:** in the **API process**. The API loads Bielik-Guard 0.1B ONNX at startup, and inference runs inline in the create/update request via `asyncio.to_thread`. Nothing is persisted when the text is rejected.
2. **Decision on text:** **reject only**. Score ≥ threshold → HTTP 400 and the user fixes the text. There is no admin review queue for text (this replaces the current NEEDS_REVIEW-only behaviour for text).
3. **Images:** **ShieldGemma only**. The worker calls VPS B `POST /v1/moderate/image` (scores: dangerous, violence, sexual, weapons) and replaces the local Falconsai NSFW classifier. VPS A owns the thresholds.
4. **Extra scope:** none selected. Needed-items description moderation, a short-name blocklist and audit of sync text decisions are all OUT of scope.
5. **Confirmed behaviour:** a field is moderated only when its value changes (create, or update with a different value). Adding a term to an existing group does not touch the group name. The backend never creates a group implicitly from a term.
