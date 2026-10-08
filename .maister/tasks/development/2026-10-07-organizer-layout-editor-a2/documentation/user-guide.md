# Wygląd strony organizacji — układ i kolory

*Ostatnia aktualizacja: 8 października 2026 · funkcja A2 „Układ i edytor”*

> ⚠️ **Uwaga dla zespołu (do usunięcia przed publikacją):** ten przewodnik nie ma jeszcze zrzutów ekranu.
> W chwili pisania lokalny backend aplikacji nie był uruchomiony, a lokalna baza danych była na migracji
> `0051`, czyli bez migracji `0052_organization_page_layout` (brak kolumn `page_layout` i `palette_preset`).
> Port 8000 zajmował mikroserwis AI, a port 8080 (cel proxy Vite) inna aplikacja Java.
> Treść powstała na podstawie specyfikacji, makiet i kodu frontendu. Zrzuty należy dodać po uruchomieniu
> backendu z kodem A2 i zastosowaniu migracji 0052. Proponowane miejsca na zrzuty oznaczono jako 📷.

---

## Spis treści

1. [Co to jest?](#co-to-jest)
2. [Jak otworzyć edytor](#jak-otworzyć-edytor)
3. [Edytor w skrócie](#edytor-w-skrócie)
4. [Wybór układu strony](#wybór-układu-strony)
5. [Wybór kolorów](#wybór-kolorów)
6. [Zapisywanie i anulowanie zmian](#zapisywanie-i-anulowanie-zmian)
7. [Co widzą odwiedzający](#co-widzą-odwiedzający)
8. [Najczęstsze pytania](#najczęstsze-pytania)

---

## Co to jest?

Twoja organizacja ma własną stronę publiczną, na przykład `domena.pl/rodzinny-grajdolek`. Teraz możesz sam zdecydować, **jak ta strona wygląda**:

- **Układ**: jak ułożone są elementy strony.
- **Kolory**: jaką paletą barw strona jest „pomalowana”.

Wszystkie zmiany widzisz od razu na swojej stronie, zanim cokolwiek zapiszesz. Odwiedzający zobaczą nowy wygląd dopiero po kliknięciu **Zapisz**.

📝 **Kto może to zrobić:** tylko właściciel organizacji, czyli osoba, która ją założyła. Musisz być zalogowany.

---

## Jak otworzyć edytor

Masz trzy drogi i każda prowadzi w to samo miejsce.

**1. Z menu konta**

Kliknij ikonę menu w prawym górnym rogu, a potem **Moja organizacja**.

📷 *Zrzut: otwarte menu konta z pozycją „Moja organizacja”.*

**2. Z panelu (strona główna)**

Na stronie głównej panelu może być widoczna karta **„Dopracuj stronę organizacji”** z opisem „Wybierz układ i kolory swojej strony — zobaczą je odwiedzający.” Kliknij **Przejdź →**.

📷 *Zrzut: karta podpowiedzi w panelu.*

**3. Prosto ze swojej strony**

Gdy oglądasz swoją stronę jako zalogowany właściciel, na dole ekranu widać ciemny przycisk **✎ Edytuj wygląd**. Kliknij go.

📷 *Zrzut: strona organizacji z przyciskiem „Edytuj wygląd”.*

✅ **Co powinieneś zobaczyć:** Twoja strona z wysuniętym od dołu panelem **„Wygląd strony”**.

💡 **Wskazówka:** jeśli nie założyłeś jeszcze organizacji, „Moja organizacja” zaprowadzi Cię najpierw do formularza jej utworzenia.

---

## Edytor w skrócie

Panel **„Wygląd strony”** ma dwie zakładki:

| Zakładka | Co w niej zmieniasz |
|---|---|
| **Układ** | Ułożenie elementów strony |
| **Kolory** | Paletę barw |

Na dole panelu są przyciski **Anuluj** i **Zapisz**, a w prawym górnym rogu przycisk **✕** (zamknij).

**Podgląd na żywo:** strona nad panelem to Twoja prawdziwa strona. Każda zmiana pojawia się na niej od razu. Możesz ją przewijać, gdy panel jest otwarty.

📷 *Zrzut: otwarty edytor, zakładka „Układ”.*

---

## Wybór układu strony

W zakładce **Układ** widzisz dwie karty z miniaturką.

### Klasyczny

*„Profil z opisem i terminami.”*

U góry jest kolorowy pas z nazwą organizacji i inicjałami, a pod nim przycisk **Udostępnij**. To układ domyślny i pasuje do większości organizacji.

### Wizytówka ⭐ Polecany

*„Same linki, jak w bio na Instagramie.”*

Nazwa i inicjały są wyśrodkowane, a pod nimi jest duży przycisk **Udostępnij stronę**. Strona przypomina prostą wizytówkę z linkami i dobrze wygląda na telefonie.

**Jak wybrać:**

1. Otwórz zakładkę **Układ**.
2. Kliknij kartę z wybranym układem. Wybrana karta ma ramkę i znaczek ✓.
3. Spójrz na stronę nad panelem: już ma nowy układ.
4. Kliknij **Zapisz**, jeśli Ci się podoba.

📷 *Zrzut: zakładka „Układ” z zaznaczoną „Wizytówką”.*

💡 **Wskazówka:** zmiana układu dotyczy tylko głównej strony organizacji. Strony terminów i produktów mają swój stały wygląd i przejmują tylko Twoje kolory.

---

## Wybór kolorów

Otwórz zakładkę **Kolory**.

📷 *Zrzut: zakładka „Kolory” z siatką palet.*

### Gotowe palety

Do wyboru jest 10 palet, a każda kafelka pokazuje kółko z kolorem głównym i akcentem:

- **Mięta (domyślna)**: standardowe kolory aplikacji
- **Ocean**
- **Lawenda**
- **Malina**
- **Słońce**
- **Las**
- **Terakota**
- **Grafit**
- **Śliwka**
- **Morze Północne**

Kliknij kafelkę, a strona od razu zmieni kolory. Wybrana paleta ma obwódkę i znaczek ✓.

✅ Wszystkie gotowe palety zostały sprawdzone pod kątem czytelności, więc tekst na przyciskach jest dobrze widoczny.

### Własny kolor

Chcesz użyć koloru swojego logo? Kliknij ostatnią kafelkę, **Własny**. Pod paletami pojawią się dodatkowe pola.

1. **Kolor główny \*** (wymagany): wybierz kolor z próbnika albo wpisz jego kod, np. `#3498db`.
2. **Akcent**: zostaw **Automatyczny**, a dobierzemy go za Ciebie. Możesz też wybrać **Własny** i wskazać drugi kolor.

📷 *Zrzut: rozwinięty wybór „Własny” z podpowiedzią o przyciemnieniu.*

💡 **Dlaczego mój kolor wygląda trochę inaczej?** Jeśli wybrany kolor jest za jasny, żeby biały tekst był na nim czytelny, aplikacja go przyciemni. Zobaczysz wtedy komunikat:

- „Lekko przyciemniliśmy kolor dla czytelności.”, gdy zmiana jest niewielka,
- „Ten kolor jest bardzo jasny — przyciemniliśmy go wyraźnie, żeby tekst był czytelny.”, gdy kolor jest bardzo jasny.

To normalne i dba o to, żeby odwiedzający mogli wszystko przeczytać.

⚠️ Kod koloru musi mieć postać `#` i sześciu znaków, np. `#2a9d8f`. Jeśli wpiszesz coś innego, zobaczysz „Podaj kolor w formacie #RRGGBB”, a przycisk **Zapisz** będzie nieaktywny, dopóki nie poprawisz kodu.

### Podgląd

W sekcji **Podgląd** są dwie małe karty: przykładowy **termin** (z przyciskiem „Zapisz się →”) i przykładowy **produkt** („Kask rowerowy”). Pokazują, jak Twoje kolory będą wyglądać na stronach terminów i produktów, których nie widać nad edytorem.

### Przywróć domyślne

Kliknij **Przywróć domyślne** pod podglądem, aby wrócić do palety **Mięta (domyślna)**. Działa to tak samo jak kliknięcie kafelki Mięta. Gdy domyślna paleta jest już wybrana, przycisk jest nieaktywny.

---

## Zapisywanie i anulowanie zmian

| Przycisk | Co robi |
|---|---|
| **Zapisz** | Zapisuje układ i kolory. Odwiedzający od razu widzą nowy wygląd. |
| **Anuluj** | Cofa niezapisane zmiany do ostatnio zapisanego wyglądu. Panel zostaje otwarty, więc możesz próbować dalej. |
| **✕** | Zamyka edytor. |

**Po kliknięciu Zapisz:**

1. Przycisk zmienia napis na **Zapisywanie…**. W tym czasie nie da się nic zmieniać w panelu, więc żadna zmiana nie przepadnie po drodze.
2. Na dole panelu pojawia się **✓ Zapisano**.
3. Panel zostaje otwarty. Możesz go zamknąć przyciskiem **✕**.

📷 *Zrzut: stopka panelu z komunikatem „✓ Zapisano”.*

💡 Gdy nie masz żadnych niezapisanych zmian, przyciski **Anuluj** i **Zapisz** są wyszarzone. To znak, że wszystko jest zapisane.

### Zamykanie z niezapisanymi zmianami

Jeśli coś zmienisz i klikniesz **✕** albo przejdziesz na inną stronę aplikacji (np. z menu konta), zobaczysz pytanie:

> **Odrzucić zmiany?**
> Wybrany układ i kolory nie zostały zapisane.

- **Wróć do edycji**: zostajesz w edytorze i nic nie tracisz.
- **Odrzuć**: zmiany przepadają, a strona wraca do zapisanego wyglądu.

📷 *Zrzut: okno „Odrzucić zmiany?”.*

⚠️ Jeśli zamkniesz kartę przeglądarki albo całą przeglądarkę, aplikacja **nie zapyta** o niezapisane zmiany. Pamiętaj, żeby najpierw kliknąć **Zapisz**.

💡 Klawisz **Esc** nie zamyka edytora, więc nie stracisz zmian przez przypadek.

---

## Co widzą odwiedzający

Aby zobaczyć stronę oczami gościa, otwórz jej adres w oknie prywatnym (incognito) albo po wylogowaniu.

📷 *Zrzut: strona w układzie „Wizytówka” widziana przez gościa.*

Odwiedzający widzą:

- nazwę i inicjały organizacji w Twoich kolorach,
- przycisk **Udostępnij** (w układzie Klasyczny) albo **Udostępnij stronę** (w Wizytówce),
- stopkę na dole strony.

Odwiedzający **nie widzą**:

- przycisku **Edytuj wygląd**,
- edytora,
- szarej ramki **„Opis — wkrótce”** (więcej o niej w pytaniach poniżej).

**Twoje kolory działają też na innych stronach:** paleta, którą wybierzesz, pojawia się również na stronach Twoich **terminów** i **produktów**. Układ dotyczy tylko głównej strony organizacji.

💡 **Udostępnianie:** na telefonie przycisk „Udostępnij” otwiera systemowe menu udostępniania (np. Messenger, SMS). Na komputerze kopiuje link do schowka i pokazuje komunikat „Skopiowano link”, który możesz potem wkleić gdzie chcesz.

---

## Najczęstsze pytania

**Na mojej stronie widzę szarą przerywaną ramkę „Opis — wkrótce”. Czy goście też ją widzą?**
Nie. Ramka jest widoczna tylko dla Ciebie i mówi o tym jej treść: „Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.” To miejsce na opis, który będzie można dodać w kolejnej wersji aplikacji. Na razie nie da się jej kliknąć.

**Kliknąłem kafelkę, a strona się zmieniła. Czy to już zapisane?**
Nie. To tylko podgląd. Wygląd zapisuje się dopiero po kliknięciu **Zapisz** i pojawieniu się **✓ Zapisano**.

**Pojawił się czerwony komunikat po kliknięciu Zapisz. Co robić?**
Twoje zmiany nadal są w edytorze, nic nie przepadło. Zależnie od komunikatu:
- **„Nie udało się zapisać. Spróbuj ponownie.”**: zwykle chwilowy problem z połączeniem. Sprawdź internet i kliknij **Zapisz** jeszcze raz.
- **Komunikat, że ktoś zmienił stronę w międzyczasie**: wygląd zmieniono w innym oknie lub na innym urządzeniu. Odśwież stronę i ustaw wygląd jeszcze raz.
- **„Nie masz uprawnień do tej akcji…”**: zaloguj się ponownie na konto właściciela organizacji.

**Przycisk Zapisz jest wyszarzony, choć coś zmieniłem.**
Sprawdź pole **Kolor główny** w opcji **Własny**. Jeśli kod koloru jest niepoprawny, popraw go albo kliknij **Anuluj**, aby wrócić do zapisanego wyglądu.

**Strona terminu ma jeszcze stare kolory.**
Odśwież stronę terminu. Nowa paleta pojawi się po chwili.

**Czy mogę zmienić nazwę albo adres strony w tym edytorze?**
Nie. Edytor zmienia tylko układ i kolory. Nazwę organizacji zmienisz jak dotąd na stronie ustawień organizacji (adres `domena.pl/organization`).

**Czy mogę dodać logo, zdjęcie albo opis?**
Jeszcze nie. Te możliwości pojawią się w kolejnych wersjach.
