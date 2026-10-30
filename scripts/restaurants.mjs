// Turun opiskelijaravintolat ja niiden ruokalistalähteet.
// lat/lon on tarkistettu osoitteesta (OpenStreetMap). Hakuskripti tarkentaa ne
// tarvittaessa uudelleen ja käyttää näitä arvoja, jos haku epäonnistuu.
//
// chain-kohtaiset tunnukset:
//   unica:  costNumber = unica.fi:n menuapi-tunnus
//   sodexo: sodexoId = sodexo.fi/ruokalistat/output/daily_json/<id>
//   karka:  karkaName = ravintolan otsikko karkafeerna.fi/fi/lounas -sivulla
//   jamix:  jamix = [asiakas, keittiö] fi.jamix.cloud-rajapinnassa
//
// hours = lounasaika viikonpäivittäin (1 = ma … 7 = su), kun rajapinta ei kerro sitä.
// Unican ajat tulevat rajapinnasta päiväkohtaisesti.
// price = opiskelijahinta, kun rajapinta ei kerro sitä (ravintolan hinnastosta).

const WEEKDAYS = (h) => ({ 1: h, 2: h, 3: h, 4: h, 5: h });

export const RESTAURANTS = [
  // Unica – yliopiston kampus
  { id: 'assari', name: 'Assarin Ullakko', chain: 'unica', costNumber: '1920', campus: 'Yliopiston kampus', address: 'Rehtorinpellonkatu 4A, Turku', lat: 60.4549, lon: 22.28829 },
  { id: 'monttu', name: 'Monttu ja Mercatori', chain: 'unica', costNumber: '1940', campus: 'Yliopiston kampus', address: 'Rehtorinpellonkatu 3, Turku', lat: 60.45461, lon: 22.28945 },
  { id: 'macciavelli', name: 'Macciavelli', chain: 'unica', costNumber: '1970', campus: 'Yliopiston kampus', address: 'Assistentinkatu 5, Turku', lat: 60.4584, lon: 22.28513 },
  { id: 'galilei', name: 'Galilei', chain: 'unica', costNumber: '1995', campus: 'Yliopiston kampus', address: 'Vesilinnantie 3, Turku', lat: 60.45551, lon: 22.28544 },
  // Unica – Kupittaan kampus
  { id: 'kisalli', name: 'Kisälli', chain: 'unica', costNumber: '1900', campus: 'Kupittaan kampus', address: 'Joukahaisenkatu 7, Turku', lat: 60.44849, lon: 22.29722 },
  { id: 'linus', name: 'Linus', chain: 'unica', costNumber: '2000', campus: 'Kupittaan kampus', address: 'Joukahaisenkatu 3, Turku', lat: 60.44906, lon: 22.29602 },
  { id: 'delica', name: 'Delica', chain: 'unica', costNumber: '1985', campus: 'Kupittaan kampus', address: 'Itäinen Pitkäkatu 4, Turku', lat: 60.449, lon: 22.29213 },
  { id: 'dental', name: 'Dental', chain: 'unica', costNumber: '1980', campus: 'Kupittaan kampus', address: 'Lemminkäisenkatu 2, Turku', lat: 60.45014, lon: 22.29195 },
  // Unica – muut
  { id: 'sigyn', name: 'Sigyn', chain: 'unica', costNumber: '1965', campus: 'Taidekampus', address: 'Linnankatu 60, Turku', lat: 60.43825, lon: 22.23856 },
  { id: 'kulma', name: 'Unican Kulma', chain: 'unica', costNumber: '1990', campus: 'Keskusta', address: 'Brahenkatu 2, Turku', lat: 60.45158, lon: 22.27156 },
  { id: 'puutori', name: 'Puutorin Nurkka', chain: 'unica', costNumber: '1930', campus: 'Keskusta', address: 'Puutori, Turku', lat: 60.45499, lon: 22.26872 },
  // Sodexo
  { id: 'flavoria', name: 'Flavoria Medisiina D', chain: 'sodexo', sodexoId: '102', campus: 'Kupittaan kampus', address: 'Kiinamyllynkatu 10, Turku', lat: 60.45251, lon: 22.29321, hours: WEEKDAYS('10:30–13:30') },
  // Kårkaféerna (Åbo Akademi)
  { id: 'aurum', name: 'Aurum', chain: 'karka', karkaName: 'Aurum', karkaId: '8', campus: 'Åbo Akademi', address: 'Henrikinkatu 2, Turku', lat: 60.4558, lon: 22.2800, hours: { 1: '10:30–18:00', 2: '10:30–18:00', 3: '10:30–18:00', 4: '10:30–18:00', 5: '10:30–14:00', 6: '12:00–15:00' } },
  { id: 'aurum-bistro', name: 'Aurum Bistro', chain: 'karka', karkaName: 'Aurum Bistro', campus: 'Åbo Akademi', address: 'Henrikinkatu 2, Turku', lat: 60.4558, lon: 22.2800, hours: WEEKDAYS('11:00–14:00') },
  { id: 'arken', name: 'Arken', chain: 'karka', karkaName: 'Arken', campus: 'Åbo Akademi', address: 'Tehtaankatu 2, Turku', lat: 60.4470, lon: 22.2610, hours: WEEKDAYS('11:00–14:30') },
  { id: 'astra', name: 'Astra', chain: 'karka', karkaName: 'Astra', campus: 'Åbo Akademi', address: 'Porthaninkatu 3, Turku', lat: 60.4528, lon: 22.2780, hours: WEEKDAYS('11:00–14:30') },
  { id: 'astra-solsidan', name: 'Astra Solsidan', chain: 'karka', karkaName: 'Astra Solsidan', campus: 'Åbo Akademi', address: 'Porthaninkatu 3, Turku', lat: 60.4528, lon: 22.2780, hours: WEEKDAYS('11:00–14:00') },
  { id: 'karen', name: 'Kåren', chain: 'karka', karkaName: 'Kåren', campus: 'Åbo Akademi', address: 'Hämeenkatu 22, Turku', lat: 60.4540, lon: 22.2770, hours: WEEKDAYS('11:00–14:00') },
  // Juvenes
  { id: 'block', name: 'Restaurant Block', chain: 'jamix', jamix: [93077, 71], campus: 'Ylioppilaskylä', address: 'Inspehtorinkatu 12, Turku', lat: 60.4637, lon: 22.2915, price: '3,10', hours: { 1: '11:00–18:00', 2: '11:00–18:00', 3: '11:00–18:00', 4: '11:00–18:00', 5: '11:00–15:00', 6: '11:00–15:00' } },
];

export const CHAIN_NAMES = { unica: 'Unica', sodexo: 'Sodexo', karka: 'Kårkaféerna', jamix: 'Juvenes' };
