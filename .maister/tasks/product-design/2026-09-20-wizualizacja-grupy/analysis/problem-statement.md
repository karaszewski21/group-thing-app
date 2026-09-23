# Problem Statement: Wizualizacja grupy zajęciowej

## Problem

Istniejący ekran grupy (`/krag/:groupId`) ma tylko jeden tryb wizualizacji uczestników (koło/mandala). Grupy różnią się charakterem (sportowe, przy stole/rzemiosło, ogólne) i chcą mieć wizualną tożsamość dopasowaną do siebie — zarówno jako metaforę pasującą do typu zajęć, jak i czysto estetyczny wybór budujący poczucie przynależności do konkretnej grupy. Dodatkowo dzisiejsza karta szczegółów uczestnika (rodziny) pokazuje tylko nazwę i opiekunów — nie pokazuje, co dana rodzina ma aktualnie do wymiany w grupie, mimo że te dane (Pledge, ItemListingPreference) już istnieją w systemie, tylko nie są zagregowane ani wyeksponowane na tym ekranie.

## Zakres (co budujemy)

1. **Trzy tryby layoutu** dla tego samego ekranu grupy: koło/mandala (już istnieje), boisko piłkarskie, stół. Każdy pokazuje tych samych uczestników i tę samą prowadzącą, tylko w innym układzie graficznym.
2. **Wybór trybu per grupa**: organizator ustawia tryb dla całej grupy (wszyscy widzą to samo), domyślnie koło; organizator może zmienić w dowolnym momencie (nie jest to ustawienie jednorazowe/zablokowane).
3. **Ikony przy uczestnikach**: "udostępnia rzecz" i "przynosi na zajęcia" — wizualny sygnał na avatarze, bez ustalonego jeszcze dokładnego zakresu czasowego (patrz Otwarte pytania).
4. **Rozszerzona karta rodziny**: po kliknięciu uczestnika, sekcja "do wymiany w grupie" pokazuje **listę wszystkich** aktywnych ofert tej rodziny (nie tylko jednej), każda z przyciskiem **"Biorę"** (bez przycisku "Napisz" — ta funkcja nie istnieje w systemie i nie jest planowana w tym zadaniu).

## Ograniczenia (constraints)

- Nie wprowadzać nowych zależności frontendowych (brak d3/canvas/layout-lib) — pozycjonowanie czystym CSS (absolute + procenty) + SVG overlay, zgodnie z istniejącym wzorcem w `KragGrupyPage.tsx`.
- Brak zmian schematu bazy danych — dane źródłowe (`Pledge`, `ItemListingPreference`) już istnieją; potrzebna jest tylko agregacja (client-side lub nowy endpoint backendowy) i (dla trybu layoutu) jedno nowe pole na `Group`.
- Styl nowego kodu: Tailwind, nie kolejny inline CSS-in-JS w `KragGrupyPage.tsx` (zgodnie z konwencją projektu i rekomendacją z analizy kodu).
- Nie duplikować logiki avatarów z inicjałami (istnieją już 2-3 kopie) — okazja do wydzielenia wspólnego komponentu.
- Formacja "boiska" nie ma znaczenia taktycznego — rozkład rodzin na sloty pozycji jest losowy/algorytmiczny, nie trzeba modelować realnych ról piłkarskich.

## Kryteria sukcesu

- Organizator może przełączyć grupę między 3 trybami layoutu i zmiana jest trwała (widoczna dla wszystkich przy kolejnych wejściach) oraz odwracalna w dowolnym momencie.
- Tryby boisko/stół poprawnie rozkładają dowolną liczbę rodzin (nie tylko liczbę z mockupu) bez nakładania się avatarów.
- Kliknięcie uczestnika pokazuje kartę z pełną, aktualną listą jego aktywnych ofert wymiany, każda z działającym przyciskiem "Biorę" (reużywającym istniejącego flow take/swap).
- Żadna nowa zależność frontendowa, żadna migracja schematu poza jednym polem trybu layoutu na `Group`.

## Otwarte pytania (świadomie odłożone)

- Dokładny zakres czasowy ikon "udostępnia"/"przynosi" (bieżący termin vs. ogólny stan) — do ustalenia później; specyfikacja przyjmie rozsądny domyślny wariant (spójny z dzisiejszą logiką widoczności `ItemListingPreference` per-Term) jako punkt startowy, możliwy do zmiany.
