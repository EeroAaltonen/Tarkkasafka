// Turun opiskelijaravintolat, joille on toimiva ruokalistarajapinta.
// lat/lon ovat likimääräisiä. Hakuskripti yrittää tarkentaa ne osoitteesta
// (OpenStreetMap Nominatim) ja käyttää näitä arvoja, jos haku epäonnistuu.
//
// Unica: costNumber = unica.fi:n menuapi-tunnus.
// Sodexo: sodexoId = sodexo.fi/ruokalistat/output/daily_json/<id>.

export const RESTAURANTS = [
  // Unica – yliopiston kampus
  { id: 'assari', name: 'Assarin Ullakko', chain: 'unica', costNumber: '1920', campus: 'Yliopiston kampus', address: 'Rehtorinpellonkatu 4A, Turku', lat: 60.4544, lon: 22.2873 },
  { id: 'monttu', name: 'Monttu ja Mercatori', chain: 'unica', costNumber: '1940', campus: 'Yliopiston kampus', address: 'Rehtorinpellonkatu 3, Turku', lat: 60.4537, lon: 22.2888 },
  { id: 'macciavelli', name: 'Macciavelli', chain: 'unica', costNumber: '1970', campus: 'Yliopiston kampus', address: 'Assistentinkatu 5, Turku', lat: 60.4558, lon: 22.2846 },
  { id: 'galilei', name: 'Galilei', chain: 'unica', costNumber: '1995', campus: 'Yliopiston kampus', address: 'Vesilinnantie 3, Turku', lat: 60.4570, lon: 22.2835 },
  // Unica – Kupittaan kampus
  { id: 'kisalli', name: 'Kisälli', chain: 'unica', costNumber: '1900', campus: 'Kupittaan kampus', address: 'Joukahaisenkatu 7, Turku', lat: 60.4488, lon: 22.2962 },
  { id: 'linus', name: 'Linus', chain: 'unica', costNumber: '2000', campus: 'Kupittaan kampus', address: 'Joukahaisenkatu 3, Turku', lat: 60.4494, lon: 22.2948 },
  { id: 'delica', name: 'Delica', chain: 'unica', costNumber: '1985', campus: 'Kupittaan kampus', address: 'Itäinen Pitkäkatu 4, Turku', lat: 60.4482, lon: 22.2895 },
  { id: 'dental', name: 'Dental', chain: 'unica', costNumber: '1980', campus: 'Kupittaan kampus', address: 'Lemminkäisenkatu 2, Turku', lat: 60.4472, lon: 22.2895 },
  // Unica – muut
  { id: 'sigyn', name: 'Sigyn', chain: 'unica', costNumber: '1965', campus: 'Taidekampus', address: 'Linnankatu 60, Turku', lat: 60.4400, lon: 22.2385 },
  { id: 'kulma', name: 'Unican Kulma', chain: 'unica', costNumber: '1990', campus: 'Keskusta', address: 'Brahenkatu 2, Turku', lat: 60.4530, lon: 22.2640 },
  { id: 'puutori', name: 'Puutorin Nurkka', chain: 'unica', costNumber: '1930', campus: 'Keskusta', address: 'Puutori, Turku', lat: 60.4525, lon: 22.2605 },
  // Sodexo
  { id: 'flavoria', name: 'Flavoria Medisiina D', chain: 'sodexo', sodexoId: '102', campus: 'Kupittaan kampus', address: 'Kiinamyllynkatu 10, Turku', lat: 60.4496, lon: 22.2880 },
];
