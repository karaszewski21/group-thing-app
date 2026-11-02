# Design Context Index

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:event-form-empty | screen | analysis/design-context/mockups/formularz-nowego-wydarzenia-pusty.html | Empty create form in the plugin iframe under the host SubPageHeader "Nowe wydarzenie"; submit disabled |
| screen:event-form-filled | screen | analysis/design-context/mockups/formularz-wype-niony-z-banerem.html | Filled form with local banner preview (Zmień/Usuń), start date+time, end time, location, description |
| screen:event-form-errors | screen | analysis/design-context/mockups/b-dy-walidacji.html | Inline Polish validation errors (name, start in past, end before start) |
| screen:event-location-picker | screen | analysis/design-context/mockups/wyb-r-lokalizacji.html | Plugin bottom sheet: my locations, "+ Dodaj nowe miejsce", "Bez lokalizacji" |
| screen:event-saving | screen | analysis/design-context/mockups/zapisywanie-wydarzenia.html | Two-step progress: event saved, banner uploading |
| screen:event-saved | screen | analysis/design-context/mockups/potwierdzenie-zapisu.html | Confirmation built from POST response; "Dodaj kolejne" / "Wróć do dodawania" (done message) |
| screen:event-banner-failed | screen | analysis/design-context/mockups/b-d-wysy-ania-banera.html | Event saved but banner upload failed: retry / skip |
| screen:event-plugin-unavailable | screen | analysis/design-context/mockups/plugin-niedost-pny.html | Host fallback when no enabled plugin provides add.event |
| screen:add-hub-toast | screen | analysis/design-context/mockups/hub-dodawania-z-toastem.html | /add hub after `done`, with host toast |
| component:banner-picker | component | analysis/design-context/mockups/formularz-wype-niony-z-banerem.html | Optional banner drop zone / preview with change & remove chips |
| component:location-field | component | analysis/design-context/mockups/wyb-r-lokalizacji.html | Location row opening the picker sheet |
