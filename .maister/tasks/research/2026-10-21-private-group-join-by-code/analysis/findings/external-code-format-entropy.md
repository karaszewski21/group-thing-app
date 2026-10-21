# External findings: join-code format, alphabet, entropy and brute-force math

**Category**: `external` (SQ5)  **Gathered**: 2026-10-21 via WebFetch/WebSearch
**Scope**: how to generate a human-typed group join code (alphabet, length, generator) and how large the
search space must be relative to the rate limit.

---

## F1. Generate with `secrets.choice` over a custom alphabet; `token_urlsafe` is for opaque URL tokens

**Source**: Python docs, `secrets` module — https://docs.python.org/3/library/secrets.html
(official reference, current 3.x docs; fetched 2026-10-21)

**Evidence** (quoted):
- `secrets.choice(seq)`: "Return a randomly chosen element from a non-empty sequence."
- `secrets.token_urlsafe(nbytes=None)`: "Return a random URL-safe text string, containing _nbytes_ random bytes.
  The text is Base64 encoded, so on average each byte results in approximately 1.3 characters."
- "As of 2015, it is believed that 32 bytes (256 bits) of randomness is sufficient for the typical use-case
  expected for the `secrets` module."
- Official recipe for a short code from a custom alphabet:
  ```python
  import string, secrets
  alphabet = string.ascii_letters + string.digits
  password = ''.join(secrets.choice(alphabet) for i in range(8))
  ```
- `secrets.compare_digest(a, b)`: "Return `True` if strings or bytes-like objects _a_ and _b_ are equal,
  otherwise `False`, using a 'constant-time compare' to reduce the risk of timing attacks."

**Context**: the project already uses `secrets.token_urlsafe(32)` in `app/oauth2/stores.py` (per `sources.md`).
That is right for machine-only tokens (refresh tokens, per-invite links) but produces mixed-case,
`-`/`_`-containing strings that are hostile to reading aloud/typing. A *human-typed* code should use
`secrets.choice` over an unambiguous alphabet. Compare with `secrets.compare_digest` (or `hmac.compare_digest`)
rather than `==`.

**Confidence**: High (official docs).

---

## F2. Crockford Base32: 32-symbol alphabet without I, L, O, U; case-insensitive; hyphens ignored

**Source**: Douglas Crockford, "Base 32" — https://www.crockford.com/base32.html (original spec by its author; undated page, stable since 2000s)

**Evidence** (quoted):
- "10 digits and 22 letters"; excluded letters: I and L ("Can be confused with `1`"), O ("Can be confused with `0`"),
  U ("Accidental obscenity").
- Encoding: "only upper case letters are used"; decoding: "upper and lower case letters are accepted."
- Lenient decoding: "`i` and `l` will be treated as `1` and `o` will be treated as `0`."
- "Hyphens are ignored during decoding." (hyphens may be inserted "to improve readability").
- Optional check symbol (mod 37) "can be used to detect wrong-symbol and transposed-symbol errors."

**Alphabet**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 symbols → exactly 5 bits per symbol).

**Context**: gives a clean normalisation rule for the input field: uppercase, map `O→0`, `I/L→1`, strip
hyphens/spaces, then validate against the alphabet. A check symbol is optional and probably overkill for an
8-char code shown next to the group name; it would mostly turn typos into an instant client-side error instead
of a server round-trip.

**Confidence**: High (primary source).

---

## F3. Real-world alphabets: Misskey uses `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (drops 0/1/I/O), 8 chars = 2^40

**Source**: misskey-dev/misskey issue #11156 (opened and closed "not planned" 2023-07-07) —
https://github.com/misskey-dev/misskey/issues/11156 (community issue; maintainer comments)

**Evidence** (quoted):
- Code comment on the alphabet: "[0-9A-Z] w/o [01IO] (32 patterns)"; generator `secureRndstr(8, ...)`.
- "$32^8 = 2^{40} = 1,099,511,627,776." The issue argued for 16 chars because with 240 000 users × 16 unused
  codes = 3.84 M valid codes, "at most about 290,000 attempts would yield one valid code" when codes are looked
  up globally.
- Maintainer syuilo: "about 10 characters would be enough", "around 16 characters was the practical upper limit";
  other commenters preferred "an expiration date or an admin invite-management screen instead".

**Context**: the key lesson is not the length but the *lookup scope*. Misskey's codes are looked up globally,
so the attacker's target is "any valid code" and the effective space shrinks by the number of live codes. If a
code is verified **against one group id** (the user is on the group's page and submits the code for that
group), the attacker's target is a single code and the full space applies. See F6.

**Confidence**: High for the facts; Medium for applicability (different product).

---

## F4. Entropy formula and the "rate limit must match entropy" rule (OAuth device flow, NIST)

**Sources**:
- oauth.com, "Device Flow — Security Considerations: User Code Brute Forcing" —
  https://www.oauth.com/oauth2-servers/device-flow/security-considerations/ (Okta-maintained book by Aaron Parecki)
- NIST SP 800-63B §5.1.2 / §5.2.2 — https://pages.nist.gov/800-63-3/sp800-63b.html (US standard; page notes it
  was superseded by SP 800-63-4 on 2025-08-01, but the thresholds below are unchanged in spirit)

**Evidence** (quoted):
- oauth.com: "it is recommended that the authorization server rate-limit the endpoint used to verify user codes."
  "The rate limit should be based on the entropy of the user code in order to make a brute force attack infeasible."
  "with 8 characters out of the 20-character set described above, that provides approximately 34 bits of entropy."
- NIST 5.1.2.1: "Look-up secrets SHALL have at least 20 bits of entropy."
- NIST 5.1.2.2: "For look-up secrets that have less than 64 bits of entropy, the verifier SHALL implement a
  rate-limiting mechanism".
- NIST 5.2.2: "the verifier SHALL limit consecutive failed authentication attempts on a single account to no
  more than 100"; MAY use CAPTCHA, "wait following a failed attempt for a period of time that increases", IP
  allow-lists, risk-based checks.

**Context**: a group join code is a look-up-secret-like credential. Anything under 64 bits (i.e. every
human-typed code) *requires* a rate limit. 20 bits is the floor; the Firezone advisory (F5) shows what happens
when the only limit is per-IP.

**Confidence**: High.

---

## F5. Failure modes: per-IP-only throttling and short codes get brute-forced

**Sources**:
- Firezone advisory FZ-2026-007 (published 2026-06-22) — https://www.firezone.dev/security-advisories/fz-2026-007
- CVE-2025-47781 (6-digit login token, no brute-force protection) — https://cvefeed.io/vuln/detail/CVE-2025-47781
- Zealynx pentest finding F-2026-0007 — https://www.zealynx.io/audits/novaswap/blackbox-pentest-q1-2026/findings/F-2026-0007

**Evidence** (quoted/paraphrased):
- Firezone: "The only throttle in front of the verification endpoint was a per-source-IP rate limit." The code
  "had insufficient entropy". Fix: "substantially increases the entropy of the one-time code" and "enforces a strict
  limit on the number of verification attempts per code". Pre-fix lifetime was 15 minutes.
- CVE-2025-47781: a 6-digit login token with no brute-force protection was exploitable.
- Zealynx: a WAF per-IP limit "could be bypassed by switching browsers"; recommended a per-client limit that
  survives that, plus per-user single-use codes for high-assurance gating.

**Context**: for this app the join endpoint requires a logged-in user (membership needs a user id), so the
natural, un-spoofable limit key is **(user_id, group_id)** plus a global per-user budget, with per-IP as an
optional extra for anonymous probing. A per-code cap (Firezone's fix) maps to "N failed attempts on a group
within a window → that group's code is temporarily locked for everyone" — strong but DoS-able; use a long
window and a high threshold if at all.

**Confidence**: High (primary advisories).

---

## F6. Brute-force math for candidate formats (computed, deterministic)

Bits = length × log2(|alphabet|). Attack cost assumes a verify endpoint limited to **R attempts/minute** and
the code verified **against a specific group** (attacker must pick a group first — see F3).

| Format | Alphabet | Bits | Space | Expected guesses (½ space) | Time @ 10/min | Time @ 60/min |
|---|---|---|---|---|---|---|
| 6 chars Crockford | 32 | 30.0 | 1.07e9 | 5.4e8 | ~102 years | ~17 years |
| 6 chars `A-Z0-9` | 36 | 31.0 | 2.18e9 | 1.1e9 | ~207 years | ~35 years |
| 6 digits (OTP-style) | 10 | 19.9 | 1.0e6 | 5.0e5 | ~35 days | ~5.8 days |
| 8 chars Crockford | 32 | 40.0 | 1.10e12 | 5.5e11 | ~105 000 years | ~17 000 years |
| 8 chars `A-Z0-9` | 36 | 41.4 | 2.82e12 | 1.4e12 | ~268 000 years | ~45 000 years |
| 10 chars Crockford | 32 | 50.0 | 1.13e15 | 5.6e14 | astronomical | astronomical |
| `token_urlsafe(16)` (22 chars) | 64 | 128 | — | — | infeasible | infeasible |

Sensitivity to the "any group" multiplier (global lookup, G live codes): divide the expected guesses by G.
With G = 1 000 groups: 6-char Crockford → ~37 days at 10/min (uncomfortable); 8-char Crockford → ~105 years
at 10/min (fine). This is the reason to either verify per group **or** use ≥ 8 characters when the deep link
carries only the code.

Sensitivity to distributed attackers (per-IP limit only, 100 IPs): divide the time by 100. Per-user limits are
immune to this because every attempt costs an authenticated account.

**Takeaway**: 6 chars is NIST-compliant (30 bits > 20) and safe *with* per-user limiting and per-group
verification; 8 chars Crockford (40 bits) costs the user two more characters and removes the dependency on
getting the rate limiter exactly right, matches Google Classroom's 6–8 range (see `external-product-patterns.md`),
and still fits a single input (`XXXX-XXXX` display grouping). Digits-only 6-char codes are too weak without an
aggressive per-code lockout.

**Confidence**: High for the arithmetic; the attempt rates are assumptions to be fixed in the spec.
