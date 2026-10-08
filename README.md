# Portfolio Performance — SDCA + RSPS

Lokalna aplikacja webowa do liczenia performance portfela krypto z dwiema **całkowicie osobnymi** strategiami
(SDCA = tylko BTC, RSPS = zamknięta lista 37 tokenów + CASH), z porównaniem do buy & hold BTC/SOL (i opcjonalnie innych tokenów z listy).

## Uruchomienie

```bash
cd portfolio
npm install
npm run dev        # otwórz http://localhost:5173
npm test           # testy silnika (SDCA, rebalans RSPS, symulacja, benchmarki)
npm run build      # statyczny build do dist/ (npm run preview, żeby go podejrzeć)
```

Wymaga Node.js 20+ i dostępu do internetu (ceny).

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
- **Price chart**: dzienne zamknięcia wybranego tokena z ostatnich 365 dni + cena bieżąca.

## Założenia

- Sygnał z dnia D jest realizowany po cenie zamknięcia świecy D-1 (00:00 UTC), bez opłat i poślizgu.
- Sygnał SDCA w % to procent wartości części SDCA (cash + BTC); kupno jest ograniczone cashem SDCA, a sprzedaż posiadanym BTC.
- W dniach `DUPLICATED` przenoszone są posiadane ilości tokenów (bez codziennego rebalansu), więc wagi dryfują z cenami.
- Dzienny zwrot = wartość pozycji na zamknięciu D / wartość tych samych pozycji na zamknięciu D-1 (time-weighted). Różnica między wpisanym
  a przeniesionym stanem to wpłata/wypłata, a nie wynik.
- *Strategy return* to łączny TWR obu części, a *Portfolio gains* to wartość portfela względem sumy wpłat netto.
  *BTC buy & hold* i benchmarki liczone są od zamknięcia dnia poprzedzającego pierwszy sygnał.
- CASH ma emoji 💵, tak jak w załączonej liście.

© thenotoriousg. All rights reserved. Credits: Professor Adam · Crypto Investing Campus · The Real World.
