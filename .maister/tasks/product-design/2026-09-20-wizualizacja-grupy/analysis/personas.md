# Personas: Wizualizacja grupy zajęciowej

## Persona 1: Organizator / prowadząca zajęcia

- **Rola**: prowadzi grupę zajęciową (np. Kasia Wójcik z mockupów), ma uprawnienia `ORGANIZATOR`/aktywny `Leadership` na grupie.
- **Cele**: nadać grupie własną tożsamość wizualną dopasowaną do charakteru zajęć (np. boisko dla zajęć sportowych); szybko widzieć, kto z uczestników coś przynosi/udostępnia, bez wchodzenia w szczegóły każdej rodziny osobno.
- **Ból dziś**: ekran grupy pokazuje tylko jeden sztywny układ (koło); żeby sprawdzić czy ktoś ma coś do wymiany, trzeba scrollować osobne sekcje pod spodem zamiast widzieć to bezpośrednio przy uczestniku.
- **Kluczowa podróż**: wchodzi na `/krag/:groupId` → otwiera ustawienia grupy (istniejący `PATCH /groups/{id}` flow) → wybiera tryb layoutu z 3 opcji → zmiana jest od razu widoczna dla wszystkich przy kolejnym wejściu na ekran → w dowolnym momencie może to zmienić ponownie.

## Persona 2: Rodzic / opiekun (uczestnik grupy)

- **Rola**: opiekun dziecka zapisanego do grupy, reprezentowany na ekranie jako "rodzina" (avatar z inicjałami).
- **Cele**: zobaczyć kto jeszcze jest w grupie i kto prowadzi; szybko zorientować się, które rodziny mają coś do wymiany/pożyczenia i wziąć to bez zbędnych kroków.
- **Ból dziś**: karta rodziny po kliknięciu pokazuje tylko imię i opiekunów — żeby zobaczyć co dana rodzina oferuje do wymiany, trzeba by przeglądać osobną, niepowiązaną z konkretną rodziną listę "Rzeczy od innych".
- **Kluczowa podróż**: wchodzi na `/krag/:groupId` (widok w trybie ustawionym przez organizatora) → widzi ikony "udostępnia"/"przynosi" bezpośrednio przy avatarach → klika interesującego uczestnika → karta na dole pokazuje pełną listę jego aktywnych ofert wymiany → klika "Biorę" przy wybranej pozycji → uruchamia się istniejący flow `take`/`propose_swap`.

## Wspólny mianownik

Obie persony korzystają z tego samego ekranu i tych samych danych (`useKragGrupy`) — różnią się tylko uprawnieniem do zmiany trybu layoutu (organizator) vs. czystą konsumpcją widoku (rodzic). Nie ma potrzeby osobnych widoków/routingu dla każdej persony — rozróżnienie to kwestia warunkowego renderowania kontrolki zmiany trybu (widoczna tylko dla `isOrganizerViewer`, analogicznie do istniejących gate'ów w `KragGrupyPage.tsx`).
