# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (7 screens, 3 components)

| Screen/Component ID | Mockup | Covered By Task Group(s) | Status |
|---------------------|--------|--------------------------|--------|
| screen:topbar-inbox-icon | mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html | Group 8 (Inbox, Top-Bar Button & Routes): `MessagesButton` in `PublicLayout` | ✅ |
| screen:inbox | mockups/skrzynka-wiadomo-ci.html | Group 8 (Inbox, Top-Bar Button & Routes): `InboxPage`; data from Group 6 | ✅ |
| screen:thread-item | mockups/rozmowa-o-rzeczy.html | Group 7 (Thread Page UI): ITEM header, message list, day pills | ✅ |
| screen:thread-group | mockups/czat-grupy-i-terminu.html | Group 7 (Thread Page UI): GROUP/TERM header, sender names, "Organizator" chip, read-only banner | ✅ |
| screen:item-ask-button | mockups/zapytaj-o-rzecz-na-stronie-rzeczy.html | Group 9 (Chat Entry Points): `ItemViewContent` pill | ✅ |
| screen:term-chat-buttons | mockups/przyciski-czatu-na-stronie-terminu.html | Group 9 (Chat Entry Points): `PublicTermView` chat row | ✅ |
| screen:organizer-entry | mockups/wej-cia-organizatora.html | Group 9 (Chat Entry Points): GroupDetailsPage card and TermHeadCard button | ✅ |
| component:message-bubble | mockups/rozmowa-o-rzeczy.html | Group 7 (Thread Page UI): `MessageBubble.tsx` | ✅ |
| component:message-composer | mockups/rozmowa-o-rzeczy.html | Group 7 (Thread Page UI): `MessageComposer.tsx` (default and error variants) | ✅ |
| component:inbox-badge | mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html | Group 8 (Inbox, Top-Bar Button & Routes): badge inside `MessagesButton` | ✅ |

## Uncovered Items

None. All 10 screens and components are covered.

### Mockup variants the mockups do not show (handled by the spec)
- **PUBLIC-group read-only.** This reuses the `screen:thread-group` deleted-group variant. The header reads "Grupa publiczna" and the banner reads "Grupa jest publiczna — czat jest tylko do odczytu" (Group 7, spec requirement 33).
- **Per-item emoji in the inbox and thread thumb.** Both become the fixed 📦 placeholder tile (spec M10; Groups 7 and 8).
- **`#12604D` chip text** maps to `text-primary-fg` (spec requirement 42; Groups 7 and 8).
