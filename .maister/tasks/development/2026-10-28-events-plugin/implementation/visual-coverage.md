# Visual Coverage Matrix

## TL;DR
- All 11 design-context items (9 screens, 2 components) are covered by at least one task group: 100% coverage.
- The host renders 2 screens (Group 6). The plugin renders 7 screens and both components (Groups 8 and 9).
- `screen:event-form-empty` is split across two groups: the host header and iframe (Group 6) and the plugin form (Group 8).

Source: `analysis/design-context/INDEX.md`

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:event-form-empty | Group 6 (Host Event Create View: header + iframe), Group 8 (Events Plugin Form & Location Sheet: form) | ✅ |
| screen:event-form-filled | Group 8 (Events Plugin Form & Location Sheet) | ✅ |
| screen:event-form-errors | Group 8 (Events Plugin Form & Location Sheet) | ✅ |
| screen:event-location-picker | Group 8 (Events Plugin Form & Location Sheet) | ✅ |
| screen:event-saving | Group 9 (Events Plugin Save Flow) | ✅ |
| screen:event-saved | Group 9 (Events Plugin Save Flow) | ✅ |
| screen:event-banner-failed | Group 9 (Events Plugin Save Flow) | ✅ |
| screen:event-plugin-unavailable | Group 6 (Host Event Create View) | ✅ |
| screen:add-hub-toast | Group 6 (Host Event Create View) | ✅ |
| component:banner-picker | Group 8 (Events Plugin Form & Location Sheet) | ✅ |
| component:location-field | Group 8 (Events Plugin Form & Location Sheet) | ✅ |

## Uncovered Items

All screens covered.

## Notes on spec corrections against mockups
- `screen:event-form-empty`: the date and time fields are blank. The prefill in the mockup is only illustrative.
- `component:banner-picker`: the hint reads "JPG, PNG lub WebP, do 5 MB". The mockup's "JPEG" is corrected.
- Submit: the mockup's disabled-looking button is built as `aria-disabled="true"` with a visible hint, not with native `disabled`.
