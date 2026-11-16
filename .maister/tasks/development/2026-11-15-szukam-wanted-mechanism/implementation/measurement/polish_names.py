"""Realistic Polish product and want names for the match measurement
(FR-T-30): inflected forms, diminutives, sizes, brands and prepositions.
Random strings would make the trigram selectivity meaningless."""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Thing:
    """One kind of object: the forms an owner writes, the forms a seeker
    writes, and the attribute pools that fit it."""

    key: str
    listed: tuple[str, ...]
    wanted: tuple[str, ...]
    adjectives: tuple[str, ...]
    brands: tuple[str, ...]
    sizes: tuple[str, ...]
    purposes: tuple[str, ...]


CHILD_SIZES = ("56", "62", "68", "74", "80", "86", "92", "98", "104", "110", "116", "122", "128", "134", "140", "152", "164")
ADULT_SIZES = ("XS", "S", "M", "L", "XL", "XXL", "36", "38", "40", "42", "44")
SHOE_SIZES = ("20", "22", "24", "26", "28", "30", "32", "34", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45")
AGES = ("0-3 mies.", "3-6 mies.", "6-12 mies.", "1-2 lata", "2-3 lata", "3-5 lat", "5-7 lat", "8-10 lat")
WHEELS = ('12"', '14"', '16"', '20"', '24"', '26"', '28"', "12 cali", "16 cali", "20 cali")
SCREENS = ("24", "32", "43", "50", "55", "65", "32 cale", "43 cale", "55 cali")
NONE: tuple[str, ...] = ()

CLOTHES_BRANDS = ("H&M", "Zara", "Reserved", "Sinsay", "Pepco", "Smyk", "Cool Club", "5.10.15", "Coccodrillo", "Reima", "4F", "Adidas", "Nike", "Puma", "Decathlon", "Quechua", "Lupilu", "C&A", "Next", "Mayoral")
SHOE_BRANDS = ("Bartek", "Lasocki", "Ecco", "Geox", "Adidas", "Nike", "Kappa", "Crocs", "Befado", "Superfit", "Deichmann", "CCC", "Skechers", "New Balance")
TOY_BRANDS = ("LEGO", "Lego Duplo", "Fisher-Price", "Playmobil", "Smoby", "Mattel", "Hasbro", "Cobi", "Trefl", "Clementoni", "VTech", "Chicco", "Ravensburger", "Granna")
BABY_BRANDS = ("Chicco", "Kinderkraft", "Lionelo", "Cybex", "Maxi-Cosi", "Baby Design", "Bebetto", "Joie", "Britax", "Caretero", "Graco", "Avent", "Canpol", "Lovi")
BIKE_BRANDS = ("Kross", "Romet", "Btwin", "Puky", "Woom", "Merida", "Giant", "Kellys", "Unibike", "Trek", "Scott", "Cube")
SPORT_BRANDS = ("Decathlon", "Oxelo", "Rossignol", "Atomic", "Head", "Salomon", "Fischer", "Tempish", "Spokey", "Meteor", "Nils", "Wed'ze")
HOME_BRANDS = ("IKEA", "Jysk", "Agata", "Black Red White", "Bodzio", "Tefal", "Philips", "Bosch", "Zelmer", "Amica", "Electrolux", "Samsung", "LG", "Xiaomi", "Sony", "Panasonic")
TOOL_BRANDS = ("Bosch", "Makita", "DeWalt", "Stanley", "Parkside", "Einhell", "Yato", "Graphite", "Verto", "Black+Decker")

COLOURS_F = ("czerwona", "niebieska", "zielona", "czarna", "biała", "różowa", "szara", "żółta", "granatowa", "beżowa", "brązowa", "fioletowa")
COLOURS_M = ("czerwony", "niebieski", "zielony", "czarny", "biały", "różowy", "szary", "żółty", "granatowy", "beżowy", "brązowy", "fioletowy")
COLOURS_N = ("czerwone", "niebieskie", "zielone", "czarne", "białe", "różowe", "szare", "żółte", "granatowe", "beżowe", "brązowe", "fioletowe")


def _thing(
    key: str,
    listed: str,
    wanted: str,
    adjectives: tuple[str, ...],
    brands: tuple[str, ...],
    sizes: tuple[str, ...],
    purposes: str,
) -> Thing:
    return Thing(
        key,
        tuple(listed.split("|")),
        tuple(wanted.split("|")),
        adjectives,
        brands,
        sizes,
        tuple(purposes.split("|")) if purposes else NONE,
    )


THINGS: tuple[Thing, ...] = (
    _thing("kurtka", "Kurtka|Kurtka|Kurteczka|Kurtki|Kurtka zimowa|Kurtka przejściowa|Kurtka puchowa|Kurtka przeciwdeszczowa", "kurtka|kurtka zimowa|kurtki|kurteczka|kurtka przejściowa|kurtkę zimową|kurtka puchowa", COLOURS_F + ("ciepła", "lekka", "pikowana", "ocieplana"), CLOTHES_BRANDS, CHILD_SIZES + ADULT_SIZES + AGES, "dla chłopca|dla dziewczynki|na zimę|na jesień|na narty|do przedszkola|z kapturem"),
    _thing("kombinezon", "Kombinezon|Kombinezon zimowy|Kombinezonik|Kombinezon narciarski|Kombinezony", "kombinezon|kombinezon zimowy|kombinezonu|kombinezon narciarski|kombinezonik", COLOURS_M + ("ciepły", "jednoczęściowy", "dwuczęściowy", "polarowy"), CLOTHES_BRANDS, CHILD_SIZES + AGES, "dla niemowlaka|na zimę|na sanki|dla chłopca|dla dziewczynki|do wózka"),
    _thing("buty", "Buty|Buty zimowe|Buciki|Butki|Buty sportowe|Buty trekkingowe|Buty piłkarskie|Buty narciarskie", "buty|buty zimowe|buciki|butów zimowych|buty sportowe|buty narciarskie|buty trekkingowe", COLOURS_N + ("skórzane", "ocieplane", "wodoodporne", "nowe"), SHOE_BRANDS, SHOE_SIZES, "dla chłopca|dla dziewczynki|na zimę|na rzepy|do biegania|na halę|w góry"),
    _thing("kalosze", "Kalosze|Kaloszki|Kalosze ocieplane|Gumowce", "kalosze|kaloszki|kaloszy|gumowce", COLOURS_N + ("w kropki", "z dinozaurem", "wysokie"), SHOE_BRANDS, SHOE_SIZES, "dla dziecka|na deszcz|do przedszkola|z ocieplaczem"),
    _thing("sandaly", "Sandały|Sandałki|Sandały sportowe|Klapki|Japonki", "sandały|sandałki|sandałów|klapki|japonki", COLOURS_N + ("skórzane", "letnie", "zakryte"), SHOE_BRANDS, SHOE_SIZES, "dla chłopca|dla dziewczynki|na lato|na basen|na plażę"),
    _thing("czapka", "Czapka|Czapeczka|Czapka zimowa|Czapki|Czapka z daszkiem|Komplet czapka i szalik", "czapka|czapka zimowa|czapeczka|czapki|czapka z daszkiem|czapkę", COLOURS_F + ("wełniana", "ciepła", "z pomponem", "bawełniana"), CLOTHES_BRANDS, AGES + ("48", "50", "52", "54", "56"), "dla niemowlaka|na zimę|na lato|dla chłopca|dla dziewczynki"),
    _thing("spodnie", "Spodnie|Spodenki|Spodnie dresowe|Spodnie narciarskie|Jeansy|Dżinsy|Spodnie ocieplane|Leginsy", "spodnie|spodnie narciarskie|spodenki|jeansy|dżinsy|spodni|leginsy|spodnie dresowe", COLOURS_N + ("ocieplane", "dresowe", "sztruksowe", "krótkie"), CLOTHES_BRANDS, CHILD_SIZES + ADULT_SIZES, "dla chłopca|dla dziewczynki|na narty|na szelkach|na gumce|do szkoły|na wf"),
    _thing("sukienka", "Sukienka|Sukieneczka|Sukienki|Sukienka letnia|Sukienka wizytowa|Sukienka komunijna", "sukienka|sukienki|sukienkę|sukienka wizytowa|sukienka komunijna|sukieneczka", COLOURS_F + ("w kwiaty", "tiulowa", "elegancka", "bawełniana"), CLOTHES_BRANDS, CHILD_SIZES + ADULT_SIZES, "dla dziewczynki|na wesele|na lato|na święta|do komunii|na bal"),
    _thing("bluza", "Bluza|Bluza z kapturem|Bluzy|Bluzeczka|Bluzka|Sweter|Sweterek|Polar", "bluza|bluza z kapturem|bluzy|bluzka|sweter|sweterek|polar|bluzę", COLOURS_F + ("rozpinana", "ciepła", "dresowa", "polarowa"), CLOTHES_BRANDS, CHILD_SIZES + ADULT_SIZES, "dla chłopca|dla dziewczynki|na zamek|do szkoły|na wf|z kapturem"),
    _thing("body", "Body|Body niemowlęce|Pajacyk|Pajacyki|Śpioszki|Śpiochy|Komplet body|Rampers", "body|body niemowlęce|pajacyk|pajacyki|śpioszki|śpiochy|rampers", COLOURS_N + ("bawełniane", "z długim rękawem", "z krótkim rękawem", "kopertowe"), CLOTHES_BRANDS, CHILD_SIZES[:8] + AGES[:4], "dla niemowlaka|dla noworodka|do spania|na napy|5 sztuk|3 pak"),
    _thing("rekawiczki", "Rękawiczki|Rękawice|Rękawiczki narciarskie|Rękawice bramkarskie|Szalik|Komin", "rękawiczki|rękawice|rękawiczki narciarskie|rękawice bramkarskie|szalik|komin", COLOURS_N + ("ciepłe", "wodoodporne", "jednopalczaste", "wełniane"), CLOTHES_BRANDS, ("1", "2", "3", "4", "5", "6", "S", "M", "L"), "dla dziecka|na zimę|na narty|na sznurku"),
    _thing("wozek", "Wózek|Wózek dziecięcy|Wózek spacerowy|Wózeczek|Wózek głęboki|Wózek 2w1|Wózek 3w1|Spacerówka|Gondola", "wózek|wózek spacerowy|wózek dziecięcy|spacerówka|wózka|wózek 2w1|wózek 3w1|gondola", COLOURS_M + ("lekki", "składany", "bliźniaczy", "kompletny"), BABY_BRANDS, NONE, "dla dziecka|dla lalek|dla bliźniaków|z gondolą|z fotelikiem|do biegania|na pompowanych kołach"),
    _thing("fotelik", "Fotelik|Fotelik samochodowy|Foteliki|Nosidełko|Fotelik rowerowy|Podstawka samochodowa", "fotelik|fotelik samochodowy|fotelika|nosidełko|fotelik rowerowy|podstawka", COLOURS_M + ("obrotowy", "bezpieczny", "bezwypadkowy", "z bazą"), BABY_BRANDS, ("0-13 kg", "9-18 kg", "9-36 kg", "15-36 kg", "0-18 kg", "i-Size"), "do auta|dla niemowlaka|z isofix|na rower|tyłem do kierunku jazdy"),
    _thing("lozeczko", "Łóżeczko|Łóżeczko dziecięce|Łóżeczko turystyczne|Łóżko|Łóżko piętrowe|Kołyska|Kojec", "łóżeczko|łóżeczko turystyczne|łóżko|łóżko piętrowe|łóżeczka|kołyska|kojec", COLOURS_N + ("drewniane", "sosnowe", "składane", "z szufladą"), BABY_BRANDS + HOME_BRANDS, ("120x60", "140x70", "160x80", "90x200", "80x180"), "dla dziecka|dla niemowlaka|z materacem|z barierką|z przewijakiem|dla lalek"),
    _thing("krzeselko", "Krzesełko|Krzesełko do karmienia|Krzesło|Krzesła|Krzesło biurowe|Fotel|Fotel biurowy|Taboret", "krzesełko|krzesełko do karmienia|krzesło|krzesła|krzesło biurowe|fotel|fotel biurowy", COLOURS_N + ("drewniane", "składane", "obrotowe", "regulowane"), BABY_BRANDS + HOME_BRANDS, NONE, "do karmienia|do biurka|dla dziecka|do kuchni|do jadalni|4 sztuki|z tacką"),
    _thing("rower", "Rower|Rowerek|Rower dziecięcy|Rower górski|Rower miejski|Rowerek biegowy|Rowerek trójkołowy|Rower damski|Rower męski", "rower|rowerek|rowerek biegowy|rower dziecięcy|rower górski|roweru|rower miejski|rowerek trójkołowy", COLOURS_M + ("sprawny", "aluminiowy", "używany", "składany"), BIKE_BRANDS, WHEELS, "dla chłopca|dla dziewczynki|dla dziecka|z kółkami bocznymi|z koszykiem|do miasta|z przerzutkami"),
    _thing("hulajnoga", "Hulajnoga|Hulajnogi|Hulajnoga trójkołowa|Hulajnoga elektryczna|Hulajnoga wyczynowa|Deskorolka|Deskorolki", "hulajnoga|hulajnogi|hulajnoga elektryczna|hulajnogę|deskorolka|deskorolki|hulajnoga trójkołowa", COLOURS_F + ("składana", "świecąca", "wyczynowa", "balansowa"), SPORT_BRANDS + BIKE_BRANDS, NONE, "dla dziecka|dla dorosłych|z dużymi kołami|ze świecącymi kółkami|do skateparku"),
    _thing("kask", "Kask|Kask rowerowy|Kask narciarski|Kaski|Ochraniacze|Komplet ochraniaczy", "kask|kask rowerowy|kask narciarski|kasku|ochraniacze", COLOURS_M + ("regulowany", "lekki", "dziecięcy"), SPORT_BRANDS + BIKE_BRANDS, ("48-52", "52-56", "54-58", "S", "M", "L", "XS"), "dla dziecka|na rower|na narty|na rolki|na hulajnogę|z goglami"),
    _thing("narty", "Narty|Narty zjazdowe|Narty biegowe|Nartki|Kijki narciarskie|Deska snowboardowa|Snowboard", "narty|narty zjazdowe|narty biegowe|nart|kijki narciarskie|snowboard|deska snowboardowa", COLOURS_N + ("dziecięce", "juniorskie", "damskie", "po serwisie"), SPORT_BRANDS, ("80 cm", "90 cm", "100 cm", "110 cm", "120 cm", "130 cm", "140 cm", "150 cm", "160 cm", "170 cm"), "dla dziecka|z wiązaniami|z butami|dla początkujących|komplet"),
    _thing("lyzwy", "Łyżwy|Łyżwy figurowe|Łyżwy hokejowe|Łyżwy regulowane|Rolki|Rolki regulowane|Wrotki", "łyżwy|łyżwy figurowe|łyżwy hokejowe|łyżew|rolki|rolki regulowane|wrotki", COLOURS_N + ("regulowane", "dziecięce", "damskie", "naostrzone"), SPORT_BRANDS, SHOE_SIZES + ("29-32", "33-36", "37-40"), "dla dziewczynki|dla chłopca|dla dziecka|z pokrowcem|na lodowisko"),
    _thing("sanki", "Sanki|Sanki drewniane|Sanki plastikowe|Saneczki|Ślizg|Jabłuszko do zjeżdżania", "sanki|sanki drewniane|sanek|saneczki|ślizg|jabłuszko", COLOURS_N + ("drewniane", "plastikowe", "metalowe", "składane"), SPORT_BRANDS, NONE, "dla dziecka|z oparciem|z pchaczem|ze sznurkiem|z materacykiem|dla dwójki dzieci"),
    _thing("pilka", "Piłka|Piłka nożna|Piłka do koszykówki|Piłka siatkowa|Piłki|Piłka gimnastyczna|Piłeczki", "piłka|piłka nożna|piłka do koszykówki|piłki|piłkę nożną|piłka gimnastyczna", COLOURS_F + ("skórzana", "gumowa", "meczowa", "treningowa"), SPORT_BRANDS + ("Select", "Molten", "Mikasa", "Adidas", "Nike"), ("3", "4", "5", "55 cm", "65 cm", "75 cm"), "dla dzieci|do nogi|do siatkówki|na plażę|do ćwiczeń|z pompką"),
    _thing("namiot", "Namiot|Namiot turystyczny|Namiot plażowy|Namiocik|Śpiwór|Karimata|Plecak turystyczny", "namiot|namiot turystyczny|namiotu|śpiwór|karimata|plecak turystyczny|namiot plażowy", COLOURS_M + ("dwuosobowy", "czteroosobowy", "samorozkładający", "lekki"), SPORT_BRANDS, ("2-osobowy", "3-osobowy", "4-osobowy", "40 l", "60 l"), "dla dzieci|na plażę|w góry|na biwak|z tropikiem|do ogrodu"),
    _thing("plecak", "Plecak|Plecak szkolny|Plecaczek|Tornister|Plecak przedszkolny|Worek na buty|Piórnik", "plecak|plecak szkolny|plecaczek|tornister|plecaka|piórnik|worek na buty", COLOURS_M + ("lekki", "ergonomiczny", "na kółkach", "usztywniany"), ("CoolPack", "Paso", "Herlitz", "Topgal", "St. Majewski", "Astra", "Derform", "Nike", "Adidas", "4F"), ("klasa 1-3", "klasa 4-8", "20 l", "25 l"), "dla chłopca|dla dziewczynki|do szkoły|do przedszkola|z piórnikiem|na wycieczkę"),
    _thing("klocki", "Klocki|Klocki drewniane|Klocki magnetyczne|Zestaw klocków|Klocki konstrukcyjne|Klocuszki|Klocki piankowe", "klocki|klocki lego|klocki drewniane|klocków|klocki magnetyczne|klocki duplo", COLOURS_N + ("drewniane", "duże", "kompletne", "mieszane"), TOY_BRANDS, ("50 elementów", "100 elementów", "250 el.", "500 el.", "1000 elementów", "1 kg", "2 kg"), "dla dzieci|dla maluchów|z instrukcją|w pudełku|od 3 lat|City|Technic|Friends|Ninjago"),
    _thing("lalka", "Lalka|Lalki|Laleczka|Lalka Barbie|Lalka bobas|Domek dla lalek|Wózek dla lalek|Ubranka dla lalek", "lalka|lalki|lalka barbie|lalkę|domek dla lalek|wózek dla lalek|laleczka|ubranka dla lalek", COLOURS_F + ("mówiąca", "interaktywna", "szmaciana", "duża"), TOY_BRANDS + ("Barbie", "Baby Born", "Zapf", "LOL", "Monster High"), ("30 cm", "43 cm", "50 cm"), "dla dziewczynki|z ubrankami|z akcesoriami|z butelką|z nocnikiem"),
    _thing("auto", "Samochód|Samochodzik|Autko|Auto zdalnie sterowane|Samochodziki|Resoraki|Traktor|Koparka|Wywrotka", "samochód|samochodzik|autko|auto zdalnie sterowane|samochodziki|resoraki|traktor|koparka", COLOURS_M + ("duży", "metalowy", "zdalnie sterowany", "drewniany"), TOY_BRANDS + ("Hot Wheels", "Bruder", "Wader", "Siku", "Majorette"), ("1:14", "1:18", "1:24", "1:32"), "dla chłopca|na pilota|na akumulator|z przyczepą|do piaskownicy|z napędem"),
    _thing("puzzle", "Puzzle|Puzzle drewniane|Układanka|Układanki|Gra planszowa|Gry planszowe|Gra karciana", "puzzle|układanka|gra planszowa|gry planszowe|puzzli|gra karciana", COLOURS_N + ("kompletne", "edukacyjne", "rodzinne", "nowe"), TOY_BRANDS + ("Rebel", "Egmont", "Castorland", "Alexander"), ("30 elementów", "60 el.", "100 elementów", "500 elementów", "1000 el.", "2000 elementów", "5+", "8+"), "dla dzieci|dla całej rodziny|od 4 lat|dla dwóch osób|po polsku"),
    _thing("pluszak", "Pluszak|Pluszaki|Miś|Misiek|Miś pluszowy|Maskotka|Maskotki|Przytulanka", "pluszak|pluszaki|miś|miś pluszowy|maskotka|maskotki|przytulanka|misia", COLOURS_M + ("duży", "mały", "miękki", "grający"), TOY_BRANDS + ("IKEA", "Disney", "Ty", "Steiff"), ("20 cm", "30 cm", "50 cm", "100 cm"), "dla dziecka|dla niemowlaka|do przytulania|z pozytywką|do spania"),
    _thing("ksiazka", "Książka|Książki|Książeczka|Książeczki|Zestaw książek|Komiks|Komiksy|Podręcznik|Lektura", "książka|książki|książeczki|książkę|komiks|komiksy|podręcznik|lektura|książki dla dzieci", ("twarda oprawa", "ilustrowana", "dźwiękowa", "kartonowa", "nowa", "używana"), ("Nasza Księgarnia", "Egmont", "Zielona Sowa", "Wilga", "Media Rodzina", "Znak", "Dwie Siostry", "Olesiejuk"), ("tom 1", "tom 2", "tom 3", "część 1", "część 2", "klasa 1", "klasa 4", "klasa 7"), "dla dzieci|dla młodzieży|do nauki czytania|po angielsku|do matematyki|o dinozaurach|o zwierzętach|na dobranoc"),
    _thing("stol", "Stół|Stolik|Stoliczek|Stół rozkładany|Stolik kawowy|Biurko|Biureczko|Ława", "stół|stolik|stół rozkładany|biurko|stołu|stolik kawowy|ława|biurko dla dziecka", COLOURS_M + ("drewniany", "dębowy", "rozkładany", "okrągły"), HOME_BRANDS, ("120x80", "140x80", "160x90", "80x80", "100 cm", "120 cm"), "do kuchni|do salonu|do jadalni|dla dziecka|do pokoju|z krzesłami|z szufladami|na balkon"),
    _thing("szafa", "Szafa|Szafka|Szafki|Komoda|Regał|Regalik|Szafka nocna|Szafa przesuwna|Półka", "szafa|szafka|komoda|regał|szafy|szafka nocna|półka|szafa przesuwna|regał na książki", COLOURS_F + ("drewniana", "sosnowa", "dwudrzwiowa", "z lustrem"), HOME_BRANDS, ("80 cm", "100 cm", "120 cm", "150 cm", "180 cm", "200 cm"), "do pokoju|do przedpokoju|do łazienki|na ubrania|na książki|na buty|z szufladami|dla dziecka"),
    _thing("kanapa", "Kanapa|Sofa|Narożnik|Wersalka|Kanapa rozkładana|Tapczan|Pufa|Materac", "kanapa|sofa|narożnik|wersalka|kanapa rozkładana|kanapę|tapczan|pufa|materac", COLOURS_F + ("rozkładana", "trzyosobowa", "skórzana", "welurowa"), HOME_BRANDS, ("2-osobowa", "3-osobowa", "160x200", "140x200", "90x200"), "do salonu|do pokoju|z funkcją spania|z pojemnikiem na pościel|dla dziecka|na działkę"),
    _thing("lampa", "Lampa|Lampka|Lampka nocna|Lampa stojąca|Żyrandol|Kinkiet|Lampka biurkowa", "lampa|lampka|lampka nocna|lampa stojąca|żyrandol|lampkę|lampka biurkowa", COLOURS_F + ("metalowa", "ledowa", "stojąca", "wisząca"), HOME_BRANDS, NONE, "do pokoju|do salonu|na biurko|dla dziecka|do sypialni|z abażurem|na baterie"),
    _thing("telewizor", "Telewizor|Telewizor LED|Telewizor Smart TV|TV|Monitor|Monitor komputerowy|Dekoder", "telewizor|telewizor led|tv|monitor|telewizora|smart tv|dekoder", ("sprawny", "z pilotem", "płaski", "4K", "Full HD"), ("Samsung", "LG", "Sony", "Philips", "Panasonic", "Xiaomi", "TCL", "Sharp", "Thomson", "Dell", "AOC"), SCREENS, "do pokoju|z pilotem|z uchwytem|na ścianę|do kuchni|z dekoderem"),
    _thing("laptop", "Laptop|Laptopy|Komputer|Komputer stacjonarny|Tablet|Klawiatura|Myszka|Drukarka", "laptop|komputer|tablet|laptopa|klawiatura|myszka|drukarka|komputer stacjonarny", ("sprawny", "używany", "biznesowy", "z ładowarką", "bezprzewodowa"), ("Lenovo", "Dell", "HP", "Asus", "Acer", "Apple", "Samsung", "Huawei", "Logitech", "Canon", "Epson", "Brother"), ("13", "14", "15,6", "17", "8 GB", "16 GB", "256 GB", "512 GB", "10 cali"), "do nauki|dla dziecka|do pracy|do szkoły|z torbą|z zasilaczem"),
    _thing("telefon", "Telefon|Smartfon|Telefon komórkowy|Słuchawki|Słuchawki bezprzewodowe|Ładowarka|Etui", "telefon|smartfon|słuchawki|telefonu|ładowarka|etui|słuchawki bezprzewodowe", ("sprawny", "bez simlocka", "z etui", "z pudełkiem", "używany"), ("Samsung", "Xiaomi", "Apple", "iPhone", "Huawei", "Motorola", "Nokia", "Oppo", "Realme", "JBL", "Sony"), ("32 GB", "64 GB", "128 GB", "256 GB", "A52", "A13", "11", "12", "13", "SE"), "dla dziecka|dla seniora|z ładowarką|na kartę|do telefonu"),
    _thing("odkurzacz", "Odkurzacz|Odkurzacz bezworkowy|Odkurzacz pionowy|Mop|Mop parowy|Żelazko|Deska do prasowania", "odkurzacz|odkurzacz bezworkowy|odkurzacza|mop|żelazko|deska do prasowania|odkurzacz pionowy", COLOURS_M + ("sprawny", "bezworkowy", "cichy", "piorący"), HOME_BRANDS + ("Dyson", "Karcher", "Vileda", "Rowenta"), ("1400 W", "1600 W", "2000 W", "2200 W"), "do domu|do auta|z workami|z końcówkami|do dywanów|na parę"),
    _thing("garnek", "Garnek|Garnki|Zestaw garnków|Patelnia|Patelnie|Rondel|Brytfanna|Czajnik|Szybkowar", "garnek|garnki|patelnia|zestaw garnków|rondel|czajnik|garnka|szybkowar|brytfanna", COLOURS_M + ("emaliowany", "stalowy", "żeliwny", "nieprzywierający"), ("Tefal", "Gerlach", "Ambition", "Zwieger", "IKEA", "WMF", "Florina", "Lagostina"), ("1 l", "2 l", "3 l", "5 l", "24 cm", "28 cm", "5 sztuk"), "na indukcję|na gaz|z pokrywką|do zupy|do kuchni|dla studenta"),
    _thing("talerze", "Talerze|Talerz|Komplet talerzy|Kubki|Kubek|Szklanki|Filiżanki|Sztućce|Serwis obiadowy", "talerze|kubki|szklanki|komplet talerzy|filiżanki|sztućce|kubek|serwis obiadowy", COLOURS_N + ("porcelanowe", "szklane", "ceramiczne", "nowe"), ("IKEA", "Luminarc", "Lubiana", "Ćmielów", "Bolesławiec", "Arcoroc", "Duka", "Villa Italia"), ("6 sztuk", "12 sztuk", "18 elementów", "24 elementy", "300 ml"), "do kuchni|dla dzieci|dla 6 osób|na święta|do kawy|do herbaty"),
    _thing("posciel", "Pościel|Komplet pościeli|Kołdra|Kołderka|Poduszka|Poduszki|Koc|Kocyk|Prześcieradło", "pościel|kołdra|poduszka|koc|kocyk|pościeli|prześcieradło|komplet pościeli|kołderka", COLOURS_F + ("bawełniana", "flanelowa", "ciepła", "antyalergiczna"), ("IKEA", "Jysk", "Pepco", "Dormeo", "AMZ", "Darymex"), ("160x200", "140x200", "200x220", "120x90", "100x135", "40x60", "70x80"), "dla dziecka|do łóżeczka|na zimę|dla niemowlaka|z gumką|do wózka"),
    _thing("wiertarka", "Wiertarka|Wkrętarka|Wiertarko-wkrętarka|Szlifierka|Piła|Wyrzynarka|Młotek|Zestaw narzędzi|Klucze", "wiertarka|wkrętarka|szlifierka|piła|wiertarki|wyrzynarka|zestaw narzędzi|klucze|młotek", ("akumulatorowa", "udarowa", "sprawna", "kątowa", "w walizce"), TOOL_BRANDS, ("12 V", "18 V", "20 V", "500 W", "750 W", "125 mm"), "do drewna|do metalu|z akumulatorem|z ładowarką|do domu|w walizce|z wiertłami"),
    _thing("kosiarka", "Kosiarka|Kosiarka elektryczna|Kosiarka spalinowa|Podkaszarka|Grabie|Łopata|Taczka|Wąż ogrodowy", "kosiarka|kosiarka elektryczna|kosiarki|podkaszarka|grabie|łopata|taczka|wąż ogrodowy", ("elektryczna", "spalinowa", "sprawna", "ręczna", "ogrodowa"), TOOL_BRANDS + ("NAC", "Stiga", "Gardena", "Fiskars", "Husqvarna"), ("1200 W", "1600 W", "32 cm", "40 cm", "20 m", "30 m"), "do ogrodu|na działkę|do trawy|z koszem|z przedłużaczem"),
    _thing("doniczka", "Doniczka|Doniczki|Donica|Osłonka|Kwiat doniczkowy|Kwiaty|Sadzonki|Monstera|Fikus", "doniczka|doniczki|donica|kwiat doniczkowy|kwiaty|sadzonki|monstera|osłonka", COLOURS_F + ("ceramiczna", "plastikowa", "duża", "wisząca"), ("IKEA", "Lamela", "Prosperplast", "Elho"), ("12 cm", "15 cm", "20 cm", "30 cm", "40 cm"), "na balkon|na taras|do domu|z podstawką|na zioła|na parapet"),
    _thing("akwarium", "Akwarium|Akwaria|Klatka|Klatka dla chomika|Legowisko|Transporter|Drapak|Smycz|Kuweta", "akwarium|klatka|klatka dla chomika|legowisko|transporter|drapak|smycz|kuweta", COLOURS_N + ("duże", "małe", "kompletne", "z wyposażeniem"), ("Aquael", "Tetra", "Trixie", "Ferplast", "Zolux", "Kerbl"), ("25 l", "54 l", "112 l", "200 l", "60 cm", "80 cm", "S", "M", "L"), "dla psa|dla kota|dla królika|dla chomika|z filtrem|z pokrywą|dla rybek"),
    _thing("gitara", "Gitara|Gitara klasyczna|Gitara akustyczna|Gitara elektryczna|Keyboard|Pianino|Flet|Skrzypce|Ukulele", "gitara|gitara klasyczna|gitary|keyboard|pianino|flet|skrzypce|ukulele|gitara elektryczna", COLOURS_F + ("klasyczna", "akustyczna", "dziecięca", "z pokrowcem"), ("Yamaha", "Casio", "Fender", "Ibanez", "Epiphone", "Stagg", "Ever Play"), ("1/2", "3/4", "4/4", "1/4", "61 klawiszy"), "dla dziecka|dla początkujących|do nauki|z pokrowcem|ze statywem|ze stroikiem"),
    _thing("basen", "Basen|Basen ogrodowy|Basenik|Basen dmuchany|Trampolina|Huśtawka|Zjeżdżalnia|Piaskownica|Domek ogrodowy", "basen|basen ogrodowy|trampolina|huśtawka|zjeżdżalnia|piaskownica|basenu|domek ogrodowy", COLOURS_M + ("dmuchany", "stelażowy", "ogrodowy", "duży"), ("Intex", "Bestway", "Smoby", "Little Tikes", "Neo-Sport", "Step2"), ("183 cm", "244 cm", "305 cm", "366 cm", "8 ft", "10 ft", "12 ft"), "dla dzieci|do ogrodu|z pompą|z siatką|z drabinką|na działkę|z pokrywą"),
    _thing("mata", "Mata edukacyjna|Mata|Mata piankowa|Leżaczek|Bujaczek|Chodzik|Pchacz|Jeździk|Skoczek", "mata edukacyjna|mata|leżaczek|bujaczek|chodzik|pchacz|jeździk|mata piankowa", COLOURS_F + ("interaktywna", "grająca", "składana", "piankowa"), BABY_BRANDS + TOY_BRANDS, AGES[:4] + ("0+", "6+", "12+"), "dla niemowlaka|dla dziecka|z pałąkiem|z zabawkami|z melodyjkami|z wibracjami"),
    _thing("butelka", "Butelka|Butelki|Butelka antykolkowa|Laktator|Podgrzewacz|Sterylizator|Niania elektroniczna|Wanienka|Przewijak", "butelka|butelki|laktator|podgrzewacz|sterylizator|niania elektroniczna|wanienka|przewijak", COLOURS_F + ("antykolkowa", "szklana", "elektryczny", "ręczny"), BABY_BRANDS + ("Medela", "Tommee Tippee", "Dr Brown's", "Nuk", "MAM"), ("125 ml", "150 ml", "240 ml", "260 ml", "330 ml"), "dla niemowlaka|do butelek|ze smoczkiem|z kamerą|ze stojakiem|do karmienia"),
    _thing("stroj", "Strój|Strój karnawałowy|Przebranie|Kostium|Strój kąpielowy|Kąpielówki|Strój piłkarski|Kimono", "strój karnawałowy|przebranie|kostium|strój kąpielowy|kąpielówki|strój piłkarski|kimono|stroju", COLOURS_M + ("kompletny", "jednoczęściowy", "dwuczęściowy", "świecący"), CLOTHES_BRANDS + ("Disney", "Marvel", "Rubie's"), CHILD_SIZES + ADULT_SIZES[:6], "dla chłopca|dla dziewczynki|na bal|na basen|do judo|na karate|księżniczki|strażaka|Spidermana|Elsy"),
)

THING_BY_KEY = {thing.key: thing for thing in THINGS}


def product_name(rng: random.Random, thing: Thing) -> str:
    """A listing title as owners write it: the object, then up to four of
    adjective, brand, size and purpose."""
    parts = [rng.choice(thing.listed)]
    if rng.random() < 0.55:
        parts.append(rng.choice(thing.adjectives))
    if rng.random() < 0.6:
        parts.append(rng.choice(thing.brands))
    if thing.sizes and rng.random() < 0.6:
        size = rng.choice(thing.sizes)
        parts.append(rng.choice((size, f"rozm. {size}", f"r. {size}")) if size[0].isdigit() and rng.random() < 0.4 else size)
    if thing.purposes and rng.random() < 0.45:
        parts.append(rng.choice(thing.purposes))
    if rng.random() < 0.08:
        parts.append(rng.choice(("stan idealny", "jak nowe", "nowe z metką", "mało używane", "OKAZJA", "zestaw", "2 szt.")))
    name = " ".join(parts)
    return name.lower() if rng.random() < 0.15 else name


def want_name(rng: random.Random, thing: Thing) -> str:
    """What a seeker types: one to three terms, often with a size or brand."""
    parts = [rng.choice(thing.wanted)]
    roll = rng.random()
    if thing.sizes and roll < 0.35:
        parts.append(rng.choice(thing.sizes))
    elif roll < 0.5:
        parts.append(rng.choice(thing.brands))
    elif thing.purposes and roll < 0.65:
        parts.append(rng.choice(thing.purposes))
    elif roll < 0.72:
        parts.append(rng.choice(thing.adjectives))
    name = " ".join(parts)
    return name.capitalize() if rng.random() < 0.3 else name
