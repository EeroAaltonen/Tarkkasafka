# Safkatrack

Turun opiskelijaravintoloiden ruokalistat yhdessä paikassa. Asennettava web-sovellus (PWA), joka toimii puhelimessa kuin oma appi.

- **Ravintolat:** päivän ruokalistat kaikista ravintoloista, lähin ensin (📍 Lähimmät)
- **Rankkaus:** annokset tai ravintolat järjestettynä proteiinin, proteiini/energia-suhteen tai kalorien mukaan
- **Suosikit:** merkitse ruoka tähdellä ☆, niin näet missä ja milloin sitä on tarjolla tällä viikolla. Suosikit tallentuvat vain omaan selaimeesi.

## Ravintolat ja tietolähteet

| Ketju | Ravintolat | Ravintoarvot |
|---|---|---|
| Unica | Assarin Ullakko, Monttu ja Mercatori, Macciavelli, Galilei, Kisälli, Linus, Delica, Dental, Sigyn, Unican Kulma, Puutorin Nurkka | Kyllä, `menuapi/recipes/<id>` (per 100 g) |
| Sodexo | Flavoria Medisiina D | Kyllä, `nutrients`-kenttä (per 100 g, energia kJ:nä) |

Ravintoarvot ovat annoksen **pääkomponentin** arvot 100 g kohden. Lisukkeita ja kastikkeita ei lasketa mukaan, ja annokset ilman tietoja näytetään merkinnällä "Ei ravintotietoja".

Ei vielä mukana: Kårkaféerna (Arken, Aurum, Kåren, Astra), Juvenes Block, Turun AMK Lemminkäisenkatu (Sodexo, ruokalista uudistuksessa). Ravintolan lisäys: `scripts/restaurants.mjs`.

## Miten se toimii

Ravintoloiden rajapinnat eivät salli hakuja suoraan selaimesta, joten GitHub Actions hakee listat (`scripts/fetch-menus.mjs`) muutaman kerran päivässä, tallentaa ne tiedostoon `data/menus.json` ja julkaisee sivun GitHub Pagesiin. Sovellus on pelkkää HTML:ää, CSS:ää ja JavaScriptiä ilman build-vaihetta.

## Käyttöönotto

1. GitHubissa: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Päivitä ruokalistat ja julkaise → Run workflow** (tai pushaa mainiin).
3. Avaa `https://<käyttäjä>.github.io/safkatrack/` puhelimella ja valitse "Lisää kotivalikkoon".

GitHub pysäyttää ajastetut ajot, jos repoon ei tule muutoksia 60 päivään. Silloin riittää painaa Actions-välilehdellä "Enable workflow".

## Kehitys

```sh
npm test          # parserien testit
npm run fetch     # hakee data/menus.json (vaatii verkon)
npm run serve     # http://localhost:8000
```
