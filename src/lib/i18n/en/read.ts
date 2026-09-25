// Glasno branje: readAloud.ts (besedila za posamezna okna) in ui/ReadAloud.svelte.
// Stavki za odhode s postajališča so v simple.ts.
export default {
  '{h} in {m}': '{h} and {m}',
  'Dobro jutro': 'Good morning',
  'Dober dan': 'Hello',
  'Dober večer': 'Good evening',
  'Zdravo': 'Hi',
  'Hej': 'Hey',
  'Danes ni več odhodov. Prvi {day} ob {time}, linija {line}.': 'No more departures today. The first one is {day} at {time}, line {line}.',

  // Avtobus
  'Avtobus linije {line}, smer {dest}.': 'Bus on line {line} to {dest}.',
  'Naslednja postaja {stop}.': 'Next stop {stop}.',
  'Naslednja postaja {stop}, prihaja zdaj.': 'Next stop {stop}, arriving now.',
  'Naslednja postaja {stop}, čez {n} {enota}.': 'Next stop {stop}, in {n} {enota}.',
  'Vozi {n} {enota} pred voznim redom.': 'Running {n} {enota} early.',
  'Naslednje postaje: {list}.': 'Next stops: {list}.',
  '{stop} ob {time}': '{stop} at {time}',

  // Pot
  'Pot do cilja {cilj}.': 'Route to {cilj}.',
  'Pot do cilja.': 'Route to your destination.',
  'Pojdi peš {trajanje}.': 'Walk for {trajanje}.',
  'Kreni ob {time}, na cilju boš ob {arr}.': 'Leave at {time}, you will arrive at {arr}.',
  'Pojdi peš {trajanje} od postajališča {od} do postajališča {do}.': 'Walk for {trajanje} from stop {od} to stop {do}.',
  'Pojdi peš {trajanje} do postajališča {stop}.': 'Walk for {trajanje} to stop {stop}.',
  'Pojdi peš {trajanje} do cilja.': 'Walk for {trajanje} to your destination.',
  'Počakaj {trajanje}.': 'Wait {trajanje}.',
  'Ob {time} na postajališču {stop} vstopi na avtobus linije {line}, smer {dest}.': 'At {time}, at stop {stop}, board the line {line} bus to {dest}.',
  'Izstopi na postajališču {stop} ob {time}, po {n} {enota}.': 'Get off at stop {stop} at {time}, after {n} {enota}.',
  'Predlog {i}: {trajanje}, prihod ob {time}, {kako}.': 'Option {i}: {trajanje}, arriving at {time}, {kako}.',
  'Linije: {list}.': 'Lines: {list}.',
  'Ta predlog je priporočen.': 'This option is recommended.',

  // Vozni redi
  'Vozni red postajališča {stop}, {dan}.': 'Timetable for stop {stop}, {dan}.',
  'Naslednji odhodi: {list}.': 'Next departures: {list}.',
  'linija {line} ob {time}': 'line {line} at {time}',
  'Linija {line}: prvi odhod ob {first}, zadnji ob {last}.': 'Line {line}: first departure at {first}, last at {last}.',
  'Linija {line}, smer {dir}, {dan}.': 'Line {line} to {dir}, {dan}.',
  'Ni voženj za izbrani dan.': 'No trips on the selected day.',
  'Ni odhodov za izbrani dan.': 'No departures on the selected day.',
  'Naslednji odhodi ob {list}.': 'Next departures at {list}.',
  'Prvi odhod ob {first}, zadnji ob {last}, skupaj {n}.': 'First departure at {first}, last at {last}, {n} in total.',

  // Vreme
  'Vreme danes: {temp}, {opis}.': 'Weather today: {temp}, {opis}.',
  'Najvišja temperatura {max}, najnižja {min}.': 'High of {max}, low of {min}.',
  'Padavine: {mm} {enota}.': 'Precipitation: {mm} {enota}.',
  'Brez padavin.': 'No precipitation.',
  'Veter do {n} na uro.': 'Wind up to {n} per hour.',
  'Sončni vzhod ob {a}, zahod ob {b}.': 'Sunrise at {a}, sunset at {b}.',
};
