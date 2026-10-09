# Portfolio Performance — SDCA + RSPS

Lokalna aplikacja webowa do liczenia performance portfela krypto z dwiema **całkowicie osobnymi** strategiami
(SDCA = tylko BTC, RSPS = zamknięta lista 37 tokenów + CASH), z porównaniem do buy & hold BTC/SOL (i opcjonalnie innych tokenów z listy).

## Uruchomienie

Online: https://oramusapp.github.io/portfolio/ (GitHub Pages z gałęzi `main`).

Lokalnie:

```bash
cd portfolio/app
npm install
npm run dev        # otwórz http://localhost:5173
npm test           # testy silnika (SDCA, rebalans RSPS, symulacja, benchmarki)
```

Wymaga Node.js 20+ i dostępu do internetu (ceny).

## Instalacja na telefonie i aktualizacje

Aplikacja jest PWA. Otwórz https://oramusapp.github.io/portfolio/ i wybierz **Dodaj do ekranu początkowego**
(iPhone: Safari → Udostępnij; Android: Chrome → menu ⋮ → Zainstaluj aplikację).

- Nowa wersja pobiera się sama (sprawdzanie przy otwarciu aplikacji i co godzinę) i pokazuje baner **New version available → Update**.
  Aktualizacja podmienia tylko kod; sygnały, holdings i net worth zostają (`localStorage` pod tym samym adresem).
- Zmiana formatu zapisanych danych = nowa migracja w `app/src/lib/storage.ts` (`MIGRATIONS`) i podbicie `SCHEMA_VERSION`; nie zmieniaj kluczy `pp.*`.
- Dane giną tylko przy usunięciu aplikacji z telefonu albo wyczyszczeniu danych witryny w przeglądarce.
  Na iPhonie aplikacja z ekranu początkowego ma osobne dane od Safari.

## Wygląd

Tło z delikatnym „cyfrowym deszczem” (Matrix), okna jednolite. Przełącznik ☀/☾ u góry zmienia tryb dzienny / ciemny
(zapamiętywany). Tryb ciemny ma czysto czarne tło pod ekrany OLED.

## Ochrona danych

- Aplikacja nic nie nadpisuje ani nie usuwa sama: zapis następuje tylko po Twojej zmianie, a samo otwarcie aplikacji niczego nie zapisuje.
- Kilka otwartych kart/okien synchronizuje się, więc starsza karta nie nadpisze nowszych danych.
- Zastąpione i usunięte sygnały, poprzednie *Portfolio holdings* i *Net worth* trafiają do archiwum (do 300 wpisów) —
  przycisk **Backup** u góry → *Archive* → **Restore**. Nieczytelne dane też są kopiowane do archiwum, zanim cokolwiek je zastąpi.
- Zapis dzisiejszego sygnału aktualizuje *Portfolio holdings* do stanu po zleceniach (opcja zaznaczona domyślnie; odznacz, jeśli zleceń nie wykonałeś). Poprzedni stan trafia do archiwum.
- Odświeżanie cen dopisuje nowe świece i aktualizuje tylko ostatnie dni; zamknięte świece już wczytane zostają bez zmian.
- **Backup → Export backup** zapisuje wszystko do pliku `.json` (na telefonie przez menu Udostępnij), **Import backup…** wczytuje plik;
  przed importem i przed migracją formatu bieżące dane trafiają do archiwum.
- Gdy pamięć przeglądarki jest pełna lub zablokowana, aplikacja pokazuje komunikat *Could not save* zamiast milczeć.

## Struktura i publikacja

- `app/` — kod źródłowy (Vite + React + TypeScript).
- `index.html`, `assets/` w katalogu głównym — zbudowana aplikacja, którą serwuje GitHub Pages.

Po zmianach w kodzie: `cd app && npm run build`, a potem commit i push razem z katalogiem głównym (`index.html`, `assets/`).

## Stack i uzasadnienie

Vite + React + TypeScript, bez backendu i bez bibliotek wykresów (wykres to własny SVG). Wszystko działa w przeglądarce,
API Hyperliquid pozwala na zapytania z przeglądarki (CORS), więc serwer nie jest potrzebny.
Dane (sygnały z wpisanymi stanami SDCA/RSPS, wybór benchmarków i coina na wykresie ceny) są w `localStorage`,
więc przetrwają odświeżenie i restart przeglądarki. Cała historia jest odtwarzana z zapisanych sygnałów.

## Jak to działa

- **Add Signal**: sygnał na bieżący dzień UTC. SDCA: kupno/sprzedaż w % + cash SDCA i posiadane BTC;
  aplikacja pokazuje kwotę kupna (z cashu SDCA) albo ilość BTC do sprzedaży i obcina zlecenie do dostępnego cashu/BTC.
  RSPS: docelowa alokacja (walidacja sumy = 100%, tylko tokeny z listy) + obecny cash RSPS i ilości tokenów;
  aplikacja pokazuje dla każdego aktywa BUY/SELL w %, w $ i w sztukach. Formularz jest wstępnie wypełniony stanem przeniesionym z poprzedniego dnia.
- **Reset dzienny**: o 00:00 UTC zaczyna się nowy dzień i trzeba wpisać nowy sygnał. Dni bez sygnału pojawiają się jako `DUPLICATED`
  z przeniesioną alokacją. Kliknięcie wiersza pokazuje zlecenia i wynik każdej strategii osobno. `Edit` pozwala poprawić lub usunąć sygnał.
- **Ceny**: dzienne świece UTC z Hyperliquid (perpy; kPEPE/kSHIB przeliczane na 1 token), a Binance spot tylko jako zapas, gdy Hyperliquid nie odpowiada.
  Świeca bieżącego dnia jest jeszcze otwarta, więc ostatni punkt to cena live (odświeżana co minutę).
- **Portfolio** (kliknij kafelek *Portfolio value*): bieżący portfel osobno dla SDCA i RSPS — każdy coin i gotówka z ilością,
  ceną live, wartością, % alokacji w strategii, dzisiejszą zmianą (od zamknięcia 00:00 UTC) i dziennym zyskiem/stratą w $,
  plus sumy dla SDCA, RSPS i całości. Kafelek *Portfolio value* pokazuje tę samą wartość (z *Portfolio holdings*).
- **Portfolio holdings** (ikonka w prawym górnym rogu): bieżący stan każdej strategii — SDCA: ilość BTC + rezerwa gotówki,
  RSPS: tokeny z listy z ilościami + rezerwa gotówki; wartości liczą się same z ceny live. Następny sygnał startuje z tego stanu,
  a zapisanie dzisiejszego sygnału aktualizuje go o wykonane zlecenia. Wykres i KPI dalej liczone są z historii sygnałów.
- **Net worth** (ikonka w prawym dolnym rogu): ręcznie wpisywane kwoty w kategoriach Crypto, Stock market, Metals (złoto, srebro…),
  Cash (waluty) i Bank accounts, z sumą, podsumami i udziałem procentowym. Wszystkie kwoty w jednej walucie wybranej u góry (USD/PLN/EUR, bez przeliczania).
- **Price chart**: dzienne zamknięcia wybranego tokena z ostatnich 365 dni + cena bieżąca.

## Założenia

- Zlecenia w formularzu liczą się na cenach live z Hyperliquid (odświeżanie co 10 s). Zapis sygnału zapisuje te ceny jako ceny
  realizacji (bez opłat i poślizgu) i z nich liczony jest performance. Starsze sygnały bez zapisanych cen używają zamknięcia D-1.
- SDCA: **BUY x%** = x% rezerwy gotówki SDCA (1% ze $100 = BTC za $1), **SELL x%** = x% posiadanego BTC, po bieżącej cenie BTC.
- RSPS: % alokacji dotyczy całej części RSPS (tokeny + gotówka RSPS), więc wolna gotówka jest rozdzielana według sygnału.
  Zlecenia pokazują tylko kryptowaluty: ile sztuk sprzedać/kupić i za ile (najpierw sprzedaże), a gotówka jako stan przed → po.
- W dniach `DUPLICATED` przenoszone są posiadane ilości tokenów (bez codziennego rebalansu), więc wagi dryfują z cenami.
- Dzienny zwrot = wartość pozycji na zamknięciu D / wartość tych samych pozycji na zamknięciu D-1 (time-weighted). Różnica między wpisanym
  a przeniesionym stanem to wpłata/wypłata, a nie wynik.
- *Strategy return* to łączny TWR obu części, a *Portfolio gains* to wartość portfela względem sumy wpłat netto.
  *BTC buy & hold* i benchmarki liczone są od zamknięcia dnia poprzedzającego pierwszy sygnał.
- CASH ma emoji 💵, tak jak w załączonej liście.

© thenotoriousg. All rights reserved. Credits: Professor Adam · Crypto Investing Campus · The Real World.
