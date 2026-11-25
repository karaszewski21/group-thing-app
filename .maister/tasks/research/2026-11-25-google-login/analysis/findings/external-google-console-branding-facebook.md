# External: Google Cloud consent screen, verification, branding; Facebook note

## TL;DR
- `openid`/`email`/`profile` are basic identity scopes: no app verification needed; even in **Testing** status any Google user can sign in, without the 100-test-user cap or the 7-day authorization expiry (Google Cloud help, "Manage App Audience").
- To show aj's name/logo on the consent screen the app needs **brand verification**: homepage on a verified domain (Search Console) that describes the app (not just a login page) and links the same privacy policy as the consent screen; the privacy policy must explain handling of Google user data. Without it, Google shows the app without branding ("Published, Unverified … Strongly discouraged").
- Branding: prefer the Google-rendered button; a custom button must use the standard full-colour "G", Google Sans Medium 14/20, light/dark/neutral themes, a CTA such as "Zaloguj się przez Google"/"Kontynuuj z Google" (localisation encouraged), and be at least as prominent as other providers.
- Facebook can later reuse the same backend shape: an OIDC code flow with PKCE exists for manually built web flows (marked "still in testing"); the classic path returns only an access token, `email` may be missing, and user IDs are app-scoped — so a provider-generic identities table keyed by (provider/issuer, subject) with optional email is the right abstraction.

## Key Decisions
- Request only `openid email profile` — keeps the app out of sensitive-scope verification and the 100-user cap.
- Publish to "In production" (External) once privacy policy + homepage are live; Testing works for development even for non-listed users with basic scopes.
- One OAuth client per environment or one client with all dev/prod origins and redirect URIs (`http://localhost:5173`, `http://localhost:5174`, prod HTTPS) — Google requires exact URI matches.

## Open Questions / Risks
- Google's own pages conflict slightly: the production-readiness table says basic-scope Testing apps show "a warning UI indicating the app is in testing", while the Manage App Audience page says users "see no warning". Verify in the console.
- Brand verification turnaround time not documented on the fetched page (commonly a few business days — unverified).
- Does aj have a public privacy policy page and a verified domain? (outside external scope.)
- Facebook: data-deletion callback/instructions URL requirement and whether `email` is returned were not confirmed from fetched pages (Medium/low confidence from prior knowledge: Meta requires a data deletion URL or instructions for Live apps; email absent for phone-only users).

---

## 1. Publishing status and scopes

**Source**: https://support.google.com/cloud/answer/15549945 (Manage App Audience)
- Testing: up to 100 listed test users; warning shown; authorizations expire after 7 days (and offline refresh tokens).
- **Basic scopes exception**: "If the app requests only the openid, userinfo.email, and userinfo.profile scopes (or their OpenID Connect equivalents), test users don't need to be on the trusted list, see no warning, and their authorizations don't expire after seven days. This also applies to Sign in with Google." Any other scope removes the exception.
- In production: "Publish app"; any Google Account can authorize; 100-new-user cap only with unapproved sensitive/restricted scopes.
- User type External vs Internal (Internal requires a Cloud Organization; not applicable to aj).
**Confidence**: High (90%).

**Source**: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- Testing (External): basic identity scopes (`openid`, `email`, `profile`) — any user can access; "Users see a testing warning".
- Published, Unverified: any Google user; name and logo not shown because brand verification isn't complete; "Strongly discouraged".
- Published, Verified: name, logo, scopes shown without warnings.
**Confidence**: High (85%) — conflicts with the previous page on the warning only.

**Source**: https://support.google.com/cloud/answer/13463073 (app verification)
- Verification is mandatory only for sensitive/restricted scopes; for non-sensitive scopes "it is not mandatory"; showing name/logo requires lighter-weight "brand verification".

## 2. Brand verification requirements

**Source**: https://support.google.com/cloud/answer/13464321
- Homepage "must be hosted on a verified domain you own", must describe the app's functionality (not only a login page), must link the privacy policy, matching the consent-screen link.
- Privacy policy on the same domain, linked from homepage and consent screen; must explain how the app "accesses, uses, stores, and shares Google user data".
- "You must verify that you own all domains listed in your Authorized domains section" via Google Search Console by a project owner/editor.
**Relevance**: aj's public landing page and an `/about/privacy`-style page (reserved-slug aware) would be prerequisites for a branded consent screen. **Confidence**: High (90%).

## 3. Client configuration

**Sources**: https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- Authorized redirect URIs (code flow / GIS redirect mode): exact match, HTTPS except localhost.
- Authorized JavaScript origins (GIS): for dev add both `http://localhost` and `http://localhost:<port>`.
- Client secret: shown once; keep outside source tree; only needed for the code flow. Per project rules it belongs in the git-ignored `.env`, placeholders only in `.env.example`; `GOOGLE_CLIENT_ID` is not secret and may be exposed (e.g. `NEXT_PUBLIC_…` if GIS is used).

## 4. Branding guidelines

**Source**: https://developers.google.com/identity/branding-guidelines
- SDK-rendered button preferred ("always match the current branding guidelines"); custom only when it can't be used.
- CTA text: "Sign in with Google", "Sign up with Google", "Continue with Google"; localisation "permitted and encouraged"; text must not suggest creating a Google Account.
- Standard full-colour G on white, not resized/recoloured/monochrome; themes Light (#FFFFFF / stroke #747775 / text #1F1F1F), Dark (#131314 / #8E918F / #E3E3E3), Neutral (#F2F2F2 / none / #1F1F1F); Google Sans Medium 14/20; padding 12px | G | 10px | text | 12px (web).
- Don't use the G alone or "Google" alone as the label.
- "The Sign in with Google button should be displayed at least as prominently as other third party sign-in options."
**Relevance**: aj's mock `SocialAuthButtons.tsx` must be checked against this (logo asset, colours, Polish label). **Confidence**: High (90%).

## 5. Provider-generic note: Facebook

**Sources**:
- Facebook Login for web (JS SDK): https://developers.facebook.com/docs/facebook-login/web — returns `authResponse.accessToken`, `userID`, `signedRequest`; HTTPS only; `email` and `public_profile` "do not require app review"; logging out does not revoke permissions.
- OIDC code flow with PKCE for manual flows: https://developers.facebook.com/documentation/facebook-login/guides/advanced/oidc-token.md — `https://www.facebook.com/v11.0/dialog/oauth` with `response_type=code`, `scope` incl. `openid`, required `nonce` and `code_challenge` (S256 recommended), token endpoint `https://graph.facebook.com/v11.0/oauth/access_token` returning `id_token`; "still in testing".
- Manual flow (classic): https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow — code exchanged at `graph.facebook.com/vXX/oauth/access_token` with app secret; tokens inspected server-side with `/debug_token` (https://developers.facebook.com/docs/graph-api/reference/debug_token/) using an app access token.
- App-scoped user IDs: https://developers.facebook.com/docs/facebook-login/guides/map-users — IDs are per app; `token_for_business` maps across a Business Manager's apps.
**Implications** (inference, Medium 70%): identities table `(provider, subject)` unique, `email` nullable, `email_verified` provider-specific (Facebook gives no Google-style authority signal → treat as not authoritative → never auto-link by email); distinct callback path per provider for mix-up defence; an issuer/provider column instead of Google-specific columns on `users`.
**Confidence**: Medium (70%).
