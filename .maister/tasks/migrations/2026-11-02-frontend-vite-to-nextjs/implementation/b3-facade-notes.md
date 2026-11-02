# Notes for B3 (from Group 5 / C4) — what the next/navigation implementation must keep

1. Guard and tracker live outside the router: `navigationGuard.ts` registers its `popstate` listener at module load (before the router's) and can `stopImmediatePropagation()` on a blocked step; keep it imported before the app mounts. Link clicks intercepted in capture phase on `document` (works for next/link). `NavigationTracker` counts facade pushes and decrements on popstate, no router hooks — can stay.
2. `recordNavigation` must be called by the Next navigate, Link and search-param setter (feeds `useHasInAppHistory` and `getTestRouter().calls` `{method,url,scroll}`).
3. Keep `navigationState.ts` semantics (keyed by normalised pathname+search) and `resolveTo` handling of `?…`/`#…` targets.
4. `useAppHash()` (not in spec table) needs a client implementation on Next (`window.location.hash` + `hashchange`). `useAppParams` must map a `[[...path]]` catch-all to `"*"`.
5. `PublicLayout` and `OrganizerItemLayout` take `children`; `OrganizerItemContext` ready for the B2 layout to provide.
6. `renderWithRoute.tsx` keeps exports `renderWithRoute`, `getTestLocation`, `getTestRouter().{calls,navigate}`, `routeElement`, `routeWrapper`; `getTestRouter().navigate` stays the guarded facade navigate; `getTestLocation()` returns raw pathname (`/home` not normalised).
7. ESLint: remove the `react-refresh` override and router.tsx/main.tsx allowance when deleted in B3; three route-table tests (addRoute, messagesRoutes, EventPage) stay allowed until their B2 replacements. ESLint is exactly at the 15-error limit — no headroom.
