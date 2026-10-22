# Reitti

Suomenkielinen mobiiliverkkosovellus: lataa reittikuvakaappaus (Google Maps, Apple Kartat, Waze), tarkista luettu reitti ja näe reitin varrelta (n. 150 m) tietyöt, liikennetiedotteet, kaivutyöt (Helsinki), talvikunnossapito (valtion tiet, Espoon kadut), tiesääasemat ja sääennuste. Ei keksittyä dataa: tyhjät, virhe- ja "ei kattavuutta" -tilat näytetään sellaisinaan.

## Miten kuva luetaan
1. OCR selaimessa (tesseract.js, fin+eng, PSM 11) → otsikko, määränpää, "via"-tiet, km ja kesto.
2. Lähtö: sininen sijaintipallo + kartan paikannimien geokoodaus (Photon), RANSAC-sovitus Web Mercatoriin → arvio, jonka käyttäjä voi korjata.
3. Reitti: OSRM-demo (vaihtoehdot + kuvan reittiviivan kautta kulkevat ehdokkaat), paras valitaan km/kesto-vertailulla.
Vaihtoehdot: jaettu Google/Apple/Waze-linkki tai osoitteet käsin.

## Tarkkuus (3 oikeaa näytettä)
| Näyte | Määränpää | km/kesto luettu | Lähtövirhe | Laskettu vs kuva |
|---|---|---|---|---|
| Waze → Kesälahti | oikein | 385,7 km / 4 h 4 min oikein | ~1 km | 412 km (+7 %) |
| Apple → Tampere | oikein | 187 km / 2 h oikein | ~2 km | 182 km (−3 %) |
| Google → Levi | oikein | 11 h 44 min (km ei näy) | ~36 km | 14 h 47 min (+26 %) |

## Lähteet
Fintraffic Digitraffic (liikenneilmoitukset, tiesää, Harja-kunnossapito), Helsingin kaupunki (kartta.hel.fi WFS), Espoon kaupunki (AuratKartalla), Ilmatieteen laitos (avoin data), OSRM, Photon/Nominatim (OSM), OSM-kartta. Helsingin katujen aurauksesta ei ole avointa reaaliaikaista dataa.

## Kehitys
`npm ci && npm test && npm run build`. Julkaisu: traali/pelipaiva `deploy-neighbors.yml` → Cloudflare Pages `reitti`.
