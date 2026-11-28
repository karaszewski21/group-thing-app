# Workflow summary: e-mail module `app/email`

## TL;DR
Done. Stages 1+2 implemented (136/136 plan items), verified in 3 cycles (W1–W9 fixed), E2E 14/14 pass with D1 fixed afterwards, Polish user guide written. Ready for the stage-1 deploy (`EMAIL_ENABLED=true`, account mail only); stage 2 waits for W10–W12.

## Key Decisions
- W10–W12 deferred as product/ops decisions (unverified legacy accounts, retention, alerting).
- E2E D1 fixed (SMTP policy for long headers); D2 (icon placement on two done screens) and D3 (English login error, pre-existing) left as known.

## Open Questions / Risks
- Before stage 2: runbook step-6 verified-share query (W10), retention + privacy policy (W11), alerting (W12).
- Proxy/CDN in front of nginx → `set_real_ip_from` before stage 1.
- Check `List-Unsubscribe` on the first Mailgun staging send.
- Keep unrelated working-tree changes (search `search.py` + 2 tests, HomeView tile, one architecture.md line, docs/feature-* files) out of this commit.

## Artifacts
- verification/implementation-verification.md, verification/e2e-verification-report.md, verification/visual-fidelity.md, documentation/user-guide.md — all present on disk.
