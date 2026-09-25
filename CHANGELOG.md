# MoHa Mobil — Changelog

Vsi pomembnejši popravki in novosti, urejeno od najnovejšega proti najstarejšemu.
Različice sledijo [SemVer](https://semver.org/lang/sl/): `MAJOR.MINOR.PATCH`.

---

## 0.23.1 — 2026-09-26

- Vsako branje (Petra in glas telefona) se začne s pozdravom po uri na telefonu: 4–10 h »Dobro jutro«,
  10–18 h »Dober dan«, sicer »Dober večer« (Matej). Predstavitev: »Dober dan. Jaz sem Petra. …« namesto »Živjo«.

## 0.23.0 — 2026-09-26

### Spoznaj Petro
- Nova kartica »Spoznaj Petro«: obstoječi uporabnik jo ob prvem odprtju po posodobitvi vidi enkrat (`introSeen`
  v onboarding.ts, ključ `mm.introSeen.v1`), novi jo dobi kot 2. kartico vodiča (vodič je zdaj 4 kartice).
- Gumb »Poslušaj Petro«: Petra se predstavi sama (stalno besedilo, po prvem klicu iz predpomnilnika Workerja).
- Zapre se z »V redu«, s sistemskim nazaj ali Esc; branje ob zaprtju utihne.

## 0.22.9 — 2026-09-26

- Izgovorjava (Matej): »UK Gosp.« → Štuk Gosposvetska, »GH« → Garažna hiša (GH Lent), »Koš. dol« → Košaški dol.

## 0.22.8 — 2026-09-26

- Izgovorjava: »UKC« → Univerzitetni klinični center (Matej).

## 0.22.7 — 2026-09-26

- Oznake linij: črka ostane črka (Petra jo izgovori pravilno sama), število z besedo — »G šest«, »P petnajst«,
  »S enaintrideset«. Zapis »ge šest« je pokvaril izgovor črke G (Matej).

## 0.22.6 — 2026-09-26

- Izgovorjava: število pred minutami in urami z besedo v pravi obliki — »Pojdi peš 12 minut« je Petra brala
  »dvanajstih minut«; zdaj dvanajst minut, eno minuto, dve minuti, tri minute, eno uro. Ura dneva kot vrstilni
  števnik: »9–13 h« → od devete do trinajste ure, »od 17 h dalje« → od sedemnajste ure dalje.
- »Preberi na glas« na vrhu: v poti preprostega pogleda nad koraki (prej pod njimi), v listu postajališča na
  preprosti karti prvi gumb (kot pri avtobusu).

## 0.22.5 — 2026-09-26

- Glasno branje prebere največ prve tri prihode na postajališče in prve tri odhode v voznih redih (prej do 6);
  zaslon pokaže več kot prej. Krajše branje in manj porabe kvote glasu (Matej). Nastavitev `MAX_READ` v readAloud.ts.

## 0.22.4 — 2026-09-25

- Statistika: ploščica »Glas Petra ta mesec« — porabljeni znaki proti kvoti Azure F0 (500.000/mesec), merilnik,
  ocena do konca meseca in opozorilo (ikona + besedilo), ko bi kvota pošla; graf in tabela znakov po dnevih.
- Worker v analitiko zapiše znake, ki jih je sintetiziral Azure (`double4`; 0 pri zadetku v predpomnilniku).

## 0.22.3 — 2026-09-25

- Oznake linij: Petra je »P15« prebrala kot »pe petnajsti« (vrstilni števnik). Število v oznaki je zdaj
  z besedo: pe petnajst, ge šest, es enaintrideset (`numWords` v pronounce.ts, 0–999).

## 0.22.2 — 2026-09-25

### Petra prebere dolgo besedilo do konca
- Napaka: cenik je Petra prebrala le do prvega dela, nato je (brez opozorila) nadaljeval sistemski glas
  telefona, ki je »14« prebral kot »ena štiri«. Vzrok: Azure F0 sintetizira ~1 s na 100 znakov (izmerjeno:
  267 znakov 3,1 s, 500 znakov čez 4,5 s), Worker pa je čakal le 4,5 s; prekinitev med branjem posnetka ni
  bila ujeta → 500.
- Worker čaka 10 s in prekinjen prenos vrne kot 504 (ne izjema); aplikacija čaka 12 s. Besedilo v kosih:
  prvi do 250 znakov (branje začne v ~3 s), ostali do 500 — naslednji se pripravlja med branjem prejšnjega.

### Izgovorjava
- Cene in številke: »1,50 €« → 1 evro in 50 centov, »13,00 €« → 13 evrov, »49 / 39 €« → 49 ali 39 evrov,
  razpon »6–14 let« → od 6 do 14 let, »9–13 h« → od 9 do 13 ure; ure (14:35) ostanejo.
- Kratice v ceniku: P+R (parkiraj in se pelji), IJPP, MOM, TIC, 3DVA.
- Oznake »črka + število«: P15 → pe 15 (prej po števkah), S31 → es 31 (Matej).
- ć → č in đ → dž (»Vlahovića« je glas bral kot »Vlahovija«).

## 0.22.1 — 2026-09-25

### Karta v preprostem pogledu za starejše
- Postajališče in avtobus, tapnjena na karti, se v preprostem pogledu odpreta skoraj čez cel zaslon
  (prej do polovice) — starejši želijo videti čim več naenkrat (Matej).
- Ime postajališča in smer avtobusa v svoji vrstici, v celoti; prej so tri okrogle tipke smer zožile
  na »Ja…«. Gumbi z napisi, 64 px, v dveh stolpcih: Pot do postaje, Shrani med moje, Preberi na glas,
  Zapri; pri avtobusu Sledi avtobusu. Imena postaj in ciljev se lomijo namesto rezanja.
- Gumb »Nazaj« na karti je skrit, dokler je list odprt (sicer bi prekril njegov vrh).
- Ikone v gumbih z napisom v dveh vrsticah so se krčile na ~14 px (flex-shrink); zdaj ostanejo 22 px.

### Izgovorjava okrajšav
- Slovar izgovorjave (`src/lib/pronounce.ts`): pred branjem se okrajšave iz voznega reda razpišejo —
  »Prol. brigad« → Proletarskih brigad, »Ul. Poh. odr.« → Ulica Pohorskega odreda, »Zg.« → Zgornji,
  »Cesta XIV. divizije« → štirinajste divizije, ŽP, AP, OŠ, MČ, TC, ZD, TABOR … (vseh 39 okrajšav v
  imenih postajališč in smeri). Velja za Petro in sistemski glas; na zaslonu ostane zapis iz voznega reda.
  Marpromov GTFS polja `tts_stop_name` nima, zato je slovar naš nadomestek.

## 0.22.0 — 2026-09-25

### Preprost pogled: moja postajališča
- Napaka: shranjeno postajališče, ki ni v krogu 500 m, se v preprostem pogledu ni pokazalo nikjer, zato
  je bilo videti, kot da se ni shranilo (zapis v `mm.favStops.v1` je deloval).
- Nov razdelek »Moja postajališča« (med Domov in Moji kraji, da Domov ostane viden brez drsenja) z
  vsemi shranjenimi; dotik odpre odhode. »Moji avtobusi« zgoraj ostanejo kot prej.
- »+ Dodaj postajališče« odpre iskanje po imenu (brez šumnikov in ločil, po besedah: »sentiljska poc«
  najde »Šentiljska - Počehovska«), z linijami in smerjo pri vsakem zadetku, da se loči par čez cesto.
  Dotik shrani in odpre odhode. Prej je bila edina pot dotik pike na karti.

### Glasno branje na vseh oknih, z naravnim glasom
- Gumb »Preberi na glas« je zdaj na vseh oknih s prometnimi podatki: Dom (najbližja in priljubljena
  postajališča), karta (postajališče, tudi najdeno z iskanjem; avtobus; pot po korakih), vozni red
  postajališča in linije, Priljubljene, predlogi poti v načrtovalniku, vreme, cene in vozovnice ter
  vsi trije zasloni preprostega pogleda. Prej samo v preprostem pogledu.
- Med branjem je »Ustavi branje« samo na gumbu, ki bere; ob zaprtju okna, menjavi postajališča,
  dneva ali smeri branje utihne. Dolga besedila (cenik, šest postajališč na Domu) se berejo v kosih
  po stavkih, naslednji kos se prenaša med branjem prejšnjega.
- »Preberi na glas« v slovenščini zdaj bere nevronski glas Petra (Microsoft Azure) prek lastnega
  Workerja (`POST /tts`); sistemski glas telefona je bil robotski, ponekod ga ni bilo. Gumb se zato
  pokaže tudi na telefonih brez slovenskega sistemskega glasu.
- Brez povezave, ob napaki ali če Worker ne odgovori v 6 s, bere sistemski glas kot prej; angleščina
  ostane na sistemskem glasu.
- Pri sistemskem glasu ima prednost izboljšana različica, če je nameščena (npr. na iPhonu
  »Tina (izboljšano)«, voiceURI `…enhanced…`); prej je aplikacija vzela prvi lokalni, lahko osnovni glas.
- Worker: ključ je samo skrivnost (`AZURE_SPEECH_KEY`), raven Free F0 (trda meja, brez stroška),
  največ 800 znakov, 20 novih besedil na minuto na naslov IP, posnetki 24 h v predpomnilniku.
- Viri v »O aplikaciji« navajajo Microsoft Azure; imena postajališč za branje gredo Microsoftu.

---

## 0.21.0 — 2026-09-25

### Preprost pogled (nadomešča način za starejše)
- En zaslon brez spodnjih zavihkov, največ šest dejanj: moji avtobusi, Domov, moji kraji (do tri),
  drug cilj, karta, celotna aplikacija. Odhodi so na vrhu in največji; gumb Domov pride pod njimi,
  ker najbolj izrazit element na sredini pritegne pogled starejših prvi (Romano Bergstrom 2013).
- Moji avtobusi: shranjena postajališča v bližini, sicer dve najbližji (obe strani ceste), brez
  lokacije shranjena. Dotik odpre vse odhode s postajališča v velikem tisku, ne karte.
- Domov in kraji: en dotik izračuna pot od trenutne lege in jo pokaže po korakih čez cel zaslon;
  karta je na gumb. Dom in kraj se nastavita z gumbom »Sem tukaj« ali z vpisom naslova, ime kraja
  se lahko izbere med predlogi.
- Karta v preprostem pogledu: velik gumb Nazaj, gumba +/− namesto povečave s prsti, brez iskanja,
  MBajk in bucike.
- Celotna aplikacija iz preprostega pogleda ima nad zavihki ves čas viden gumb »Nazaj na preprost
  pogled«; ob naslednjem zagonu je uporabnik spet v preprostem pogledu.
- Tarče 88 px za glavne gumbe in vrstice odhodov, ≥ 64 px za ostale; vsak gumb ima napis.
- Vstop: stikalo na prvi kartici vodiča in na vrhu Nastavitev. Kdor je imel vklopljen način za
  starejše, ob posodobitvi samodejno dobi preprost pogled.

### Glasno branje
- Gumb »Preberi na glas« prebere odhode (linija, smer, čez koliko minut, zamuda) z vgrajenim
  govorom brskalnika. Pokaže se samo, če ima naprava glas v jeziku vmesnika.

### Nastavitve po kategorijah
- Prva stran je kratek seznam kategorij s trenutnimi izbirami v podnaslovu (Preprost pogled ostane
  na vrhu): Videz (jezik, tema, večje besedilo, kompaktni seznami), Lokacija (sledenje v živo, radij
  bližnjih postajališč — zdaj vedno viden), Začetni zaslon (privzeti zavihek, kaj pokaže Dom), Odhodi
  in poti, Karta, Obvestila (neposredno v opomnike), Zasebnost in podatki, Pomoč (cene, vodnik, deli,
  predlagaj), O aplikaciji (različica, viri, novosti). Prej 13 razdelkov na eni strani, sorodne
  nastavitve razmetane (sledenje lokaciji pod Karto, radij pod Domom).
- Kategorija se odpre na svoji strani (glavna ohrani položaj drsenja); sistemski nazaj jo zapre.
- Opomniki za odhod imajo namesto same puščice v kotu gumb z napisom »‹ Nastavitve« oziroma
  »‹ Priljubljene« (odvisno od tega, od kod so bili odprti) — puščice uporabnik ni prepoznal kot poti nazaj.

### Gibanje: okna in strani se odpirajo z animacijo
- Nov modul `src/lib/motion.ts` z enotnim jezikom gibanja: `backdrop` (zatemnitev in zameglitev
  ozadja se prelije), `sheet` (list zdrsne od spodaj ali od zgoraj), `page` (celozaslonska stran od
  desne kot v iOS), `swap` (menjava vsebine znotraj okna). Odpiranje 360–380 ms z mehkim ustavljanjem,
  zapiranje 220–240 ms.
- Uporabljeno povsod, kjer se kaj odpre čez aplikacijo: vozni red linije in postaje (tudi izbira
  postaje, menjava smeri in dneva), cene, vreme, planer in iskanje postaje (od zgoraj), izbira linij
  in preimenovanje v Priljubljenih, deljenje poti, potrditvena okna, opomniki in njihov urejevalnik,
  statistika, strani kategorij v Nastavitvah, zasloni Preprostega pogleda. Vozni redi: preklop
  Linije/Postaje. Segmentni gumbi (dan, Linije/Postaje) barvo spremenijo mehko.
- Ob sistemski nastavitvi »zmanjšaj gibanje« je trajanje 0 — brez animacije in brez čakanja ob zapiranju.
- Zasloni Preprostega pogleda ostanejo pod karto odprti in samo skriti (prej so se zaprli in znova
  odprli, kar bi z animacijo izgledalo kot korak nazaj); pod karto ne poizvedujejo in ne berejo.

### Večje besedilo
- Nekdanji način za starejše se imenuje Večje besedilo in ostane ločena nastavitev za običajni
  vmesnik (lestvica 1,5, kontrast AAA). V preprostem pogledu velja vedno.

Utemeljitev: `projekti/aplikacija_Mobilnost_Maas/raziskava_nacin_za_starejse.md` (Nucleus).

## 0.20.2 — 2026-09-22

- Cene in vozovnice: brezplačen prestop v 75 minutah velja po uradnem ceniku samo za vozovnice
  iz predprodaje (1 in 10 voženj, otroške), ne za vožnjo, plačano pri vozniku. Prej je stran
  trdila, da velja za vsako vozovnico. Vožnja pri vozniku in v predprodaji sta zdaj ločeni vrstici.

## 0.20.1 — 2026-09-22

- Cene in vozovnice: nov razdelek Brezplačno. Starejši in upokojenci se vozijo brezplačno s kartico
  IJPP (potrdil operater), s povezavo na obrazec za vlogo. Brezplačno se vozijo tudi invalidi s
  prebivališčem v Mariboru.

## 0.20.0 — 2026-09-22

### Angleščina
- Ves vmesnik je preveden v angleščino (razen skritega zaslona s statistiko). Jezik se
  izbere na prvi kartici vodiča ali v Nastavitvah → Izgled. Privzeto ostane slovenščina,
  ne jezik telefona: veliko domačih uporabnikov ima telefon v angleščini.
- Ključ prevoda je slovensko besedilo samo (`$t('Najbližja postajališča')`), manjkajoč
  prevod zato pokaže slovenščino. Slovarji po zaslonih v `src/lib/i18n/en/`.
  `npm run i18n:check` javi vsak `$t`/`tr` brez prevoda (ne vidi dinamičnih ključev,
  npr. zapiskov v `release.ts` — ob novem vnosu dodaj prevod ročno).
- Ob menjavi jezika se vmesnik izriše na novo (`{#key $lang}` v App.svelte); podatki
  (GTFS, lokacija) se ne nalagajo znova.
- Mimogrede popravljena slovenska množina: »2 prestopa« namesto »2 prestopov«,
  »1 vozilo« namesto »1 vozil«, »2 postaji« namesto »2 postaje«.

### MBajk na Karti
- Postaje MBajk (42) z ikono kolesa in številom prostih koles od zooma 14,5. Tap odpre
  kartico s prostimi kolesi in stojali, potjo do postaje in povezavo za registracijo.
- Pri izbranem postajališču vrstica »MBajk v bližini« (najbližja delujoča postaja do 400 m).
- Vir: javni GBFS `api.cyclocity.fr/contracts/maribor/gbfs/v2` (JCDecaux), brez ključa,
  CORS odprt → brez našega Workerja. Stanje se osveži vsako minuto, samo dokler je Karta
  odprta in sloj vklopljen (gumb levo zgoraj). Navedba vira v kartici in Nastavitvah.

### Cene in vozovnice
- Nov zaslon v Nastavitve → Pomoč: cenik Marproma (velja od 1. 6. 2026), prestop 75 min,
  nakup na avtobusu z bančno kartico, aplikacija Marprom Shop, spletna prodaja, prodajna
  mesta. Aplikacija vozovnic ne prodaja (Marprom nima javnega vmesnika).
- Brezplačne vozovnice za starejše so navedene samo s povezavo na Marpromove pogoje —
  uradna stran o tem ni bila potrjena.

### Vodič za nove uporabnike
- Tri kartice ob prvem zagonu (odhodi v živo, karta, planer) z izbiro jezika, večjega
  besedila in dovoljenjem za lokacijo; en namig na Domu, Karti in pri postajališču.
- Obstoječi uporabniki vodiča ob posodobitvi ne dobijo: `index.html` pred moduli preveri,
  ali so v shrambi ključi `mm.*` (settings.ts jih sicer ob nalaganju zapiše takoj in bi
  bil vsak nov uporabnik videti kot obstoječi).
- Nastavitve → Pomoč → Vodnik po aplikaciji ga odpre znova.

---

## Zaledje (Cloudflare Worker) — 2026-09-22

Paket aplikacije ostaja 0.19.0 — spremenjen je samo Worker, ki se objavlja ločeno.

Povod: na zaslonu s statistiko je bilo v sedmih dneh 413 neuspelih klicev zaledja.
Razpadejo na dvoje. 224-krat `503` je bil jutranji izpad posrednika na Deno Deploy
(opisan pri 0.19.0). Preostalih 195 `502` pa je nekaj drugega: **pot Cloudflare →
`vozniredi.marprom.si` občasno visi.** Izmerjeno istega popoldneva, hkratno
primerjalno: z roba 3 uspehi od 15, neposredno z računalnika 15 od 15 v ~0,15 s.
Ni kriv naš `User-Agent` (neposredno z istim 10/10) in Marpromov strežnik ni
preobremenjen. Zanimivo je tudi, da so ure z veliko prometa brez ene same napake.

### Uporabnik ne čaka več 9 sekund v prazno
- Klic navzgor se prekine po **4 s** namesto 9 s. Najpočasnejši izmerjeni **uspešen**
  klic je trajal 3,15 s, vsi ostali pod 0,8 s — nižja meja bi rezala zdrave odgovore.
- Preizkušeno je bilo tudi ponavljanje klica, a **ne deluje**: trije poskusi so dali
  2 uspeha od 21, en sam 3 od 15. Kadar prvi poskus visi, visijo vsi trije; šele nov
  klic Workerja ima spet svojo možnost. Zato ostane en sam, kratek poskus.

### Zasilni odgovor namesto praznega zaslona
- Kadar Marprom ne odgovori, Worker postreže **zadnji znani odgovor**, če ni starejši
  od TTL + 90 s. Aplikacija dobi 200 in podatek; glavi `X-Proxy-Cache: STALE` in
  `X-Proxy-Age` povesta, kako star je. V statistiki tak klic šteje kot neuspel klic
  navzgor — sicer bi števci nehali kažati, da je pot pokvarjena.
- **`ETAMin` se popravi za starost odgovora.** To je edino polje, ki se s stanjem
  pokvari (`ArrivalTime` je vozni red, `DelayMin` zamuda). Brez popravka bi star
  odgovor avtobus kazal dlje, kot je — ravno v nevarno smer. Prihodi, ki so med tem
  že minili, izpadejo.
- Predpomnilnik živih metod je zato podaljšan: prihodi 10 s → **40 s**, pozicije
  vozil 20 s → **30 s**. Vsak zadetek je klic, ki ne more pasti.
- Brskalnik živih odgovorov ne hrani več (`no-store`) — popravek ETA se zgodi v
  Workerju in odgovor v brskalnikovem predpomnilniku bi se starašal brez njega.

### Uporabnik ne čaka na klic, ki morda ne bo odgovoril
- Kadar je v predpomnilniku star odgovor, dobi klic navzgor samo **0,7 sekunde
  prednosti** — toliko, kolikor traja zdrav odgovor (izmerjeno 0,15–0,31 s). Če ne
  odgovori, gre ven star odgovor, klic pa se dokonča v ozadju in napolni
  predpomnilnik za naslednji vpogled. Čakanje štirih sekund tako odpade povsod,
  kjer sploh kaj imamo.
- Svež odgovor, ki je čez polovico življenjske dobe, sproži **osvežitev v ozadju**.
  Aplikacija sprašuje vsakih 15 s, zato je vsak vpogled še ena priložnost, da klic
  uspe — ne da bi kdo čakal.
- Klic navzgor se v statistiki zabeleži po svojem pravem izidu tudi takrat, ko se
  dokonča šele v ozadju. Števci še naprej kažejo, da je pot pokvarjena, čeprav
  uporabnik tega ne čuti.

### Cron ogreva predpomnilnik
- Ker uporabnik čaka, ponavljanje klica zanj ni rešitev — pri cron-u pa ne čaka nihče.
  Worker zato vsako minuto poskusi osvežiti **do 8 najbolj gledanih postajališč zadnjih
  30 minut**, v treh rundah, razmaknjenih 12 s. Ko en poskus uspe, dobi vsak, ki v
  naslednjih ~2 minutah pogleda to postajališče, zadetek v predpomnilniku.
- Greje se **samo tisto, kar kdo gleda**: seznam pride iz statistike zadnjih 30 minut,
  zato je ponoči prazen in cron ne naredi ničesar. Marproma ne sprašujemo po
  postajališčih, ki jih nihče ne gleda, in ne po tistih, ki so že sveža.
- Gretje piše eno podatkovno točko na klic cron-a in z lastno oznako vira, zato
  števcev uporabe na zaslonu s statistiko ne napihne.
- **Meritev je pokazala, da gretje ni rešitev, ampak dodatek.** Cloudflare cron-a
  ne požene nujno v Evropi: tekel je iz **Singapurja** in od tam Marprom ni bil
  dosegljiv niti enkrat (0 od 120 klicev), medtem ko so klici uporabnikov iz
  evropskih lokacij v istih minutah uspevali (62 od 72). Zato gre zdaj najprej
  tipanje z enim samim postajališčem — v slabi minuti odide en klic namesto osmih.
  Glavni obrambni mehanizem je osveževanje v ozadju na uporabnikovi poti.

### Popravek dokumentacije
- V README je pisalo, da Cloudflarov `caches.default` na `*.workers.dev` ne deluje.
  **To ne drži** (preverjeno: `X-Proxy-Cache: HIT`). Ni bilo nepomembno: zasilni
  odgovor je odvisen prav od tega, da si shranjeni odgovor delijo vsi izolati.

---

## 0.19.0 — 2026-09-22

Zamuda avtobusa je spet vidna, živi prihodi pa spet delujejo po jutranjem izpadu. Obe stvari sta prišli na dan iz primerjave posnetkov ob 07:26: druga aplikacija je kazala »Zamuda: 4«, naša pa »Offline · po voznem redu«.

### Izpad živih prihodov (22.09., od ~07:00 do 08:40)
- Posrednik na Deno Deploy se je ustavil sam: brezplačni paket je prekoračil kvoto in vračal `503 Service Unavailable (USAGE_EXCEEDED)`. Aplikacija je pravilno padla nazaj na vozni red in to tudi napisala, a živih podatkov in zamud ni bilo.
- **Novi števci zaledja so izpad ujeli prvi dan delovanja:** 222 neuspelih klicev OBA 22.09. proti 0 dan prej, mediana odziva 35 ms (hitre zavrnitve).
- **Ugotovitev pri odpravi:** Cloudflare od 22.09. spet pride do `vozniredi.marprom.si` neposredno (12/12 klicev 200, `GetLines` v 0,74 s). Posrednik je zato odstranjen — `OBA_RELAY` je zakomentiran, `/health` javlja `obaVia: "direct"`. Veriga je spet dvočlenska namesto tričlenske.

### Zamuda se ni izrisala nikoli (napaka od uvedbe)
- `GetArrivalsForStopPoint` **nima polja `Predicted`** — to ima samo `GetActiveDeviceDetails`. Koda je brala `!!a.Predicted`, kar je bilo vedno `false`, zato pogoj `a.predicted && absDelay >= 1` ni nikoli sprožil izrisa, značka pa je vedno pisala »ocena«.
- V surovem odgovoru je bil `DelayMin: 4` ves čas prisoten.
- Popravek: `predicted` se izpelje iz dodeljenega vozila (`BusCode`), zamuda pa se pokaže, kadar jo API pozna — novo polje `delayKnown`. S tem se loči »vemo, da vozi točno« od »zamude ne poznamo«.

### Kaj je zdaj vidno
- **Na karti, v listu postaje:** značka »v živo« ali »po redu« namesto »GPS«/»ocena«, poleg nje »+4 min« v barvi po resnosti, ETA pa obarvan pri zamudi nad 3 oziroma 5 minut.
- **Na Domu:** ob vsakem živem odhodu »+4 min« ali »točno«. Doslej Dom zamude sploh ni prikazoval.

---

## 0.18.1 — 2026-09-22

- »Ta odhod je mimo« se pokaže šele, ko je odhod res mimo (90 s); v oknu od −90 do +60 s piše »Kreni zdaj«. Prej je opozorilo skočilo že ob nekaj sekundah zamika.
- Hoja pod 30 m ni korak — vrstica »Hoja 1 min · 0 m« je bila samo šum. Čas se kljub temu upošteva, ker se računa iz odhoda avtobusa.
- »prek …« ne ponavlja več postaje vstopa in izstopa.

---

## 0.18.0 — 2026-09-22

Kartica s potjo je predelana v časovnico.

Prej je naštela »Hoja · 350 m«, »→ cel opis linije«, »5×« in čas ob strani. Trije podatki, ki jih potnik v resnici potrebuje — kdaj mora oditi, kje vstopi in kje izstopi — so bili razmetani med vsem ostalim.

- Zgoraj vodilo **»Kreni ob 07:12 · čez 4 min · na cilju ob 07:48«**, ki se osvežuje vsakih 15 s in pordeči ob zamujenem odhodu.
- Pod njim časovnica z uro na levi in hrbtenico skozi vozlišča.
- Pri avtobusu piše **»Vstopi na ‹postaja›«**, pod tem linija in cilj (namesto celega opisa linije; vmesne postaje so v drobnejši vrstici), izstop pa je poudarjen podblok z uro in imenom postaje.
- **Čakanje med prestopi je svoja vrstica** — vidiš ga vnaprej.
- Zadnje vozlišče je prihod na cilj.

Vse mere se množijo z `--ui-scale`, zato časovnica deluje tudi v načinu za starejše.

---

## 0.17.1 — 2026-09-22

- Časovnica z eno samo meritvijo ni več skoraj prazen graf: pokaže vrednost kot številko in pove, da je za črto potreben vsaj drugi dan. En dan ni časovnica.
- Naslov grafa odzivnega časa je povedal »skupaj 321 ms« — seštevek median ne pomeni nič. Zdaj piše povprečje.

---

## 0.17.0 — 2026-09-22

Statistika dobi grafe in karto. Za uporabnika se ne spremeni nič.

### Oblike so izbrane po nalogi podatka
- **Časovnice** so črta s ploskvijo (zagoni, odzivni čas) oziroma stolpci (klici zaledja) — sprememba skozi čas.
- **Primerjave** so vodoravni stolpci (zavihki, gradnje, dejanja) — velikost. Vodoravno zato, ker so oznake različno dolge besede, ki bi se pri navpičnih stolpcih morale vrteti ali krajšati.
- **Posamezne številke** ostanejo ploščice brez grafa — en podatek ni graf.
- **Postajališča** so karta (MapLibre): prostorski podatek pripada prostorski obliki.

**Nikjer ni dveh meril na eni osi.** Zato sta klici zaledja in odzivni čas dva grafa in ne eden z dvema osema — to je najpogostejša napaka pri grafih.

### Barve
Paleta je preverjena z validatorjem (OKLab, simulacija barvne slepote), ne izbrana po občutku: svetla `#2a78d6` / `#e34948` in temna `#3987e5` / `#e66767`. Razlika pri barvni slepoti ΔE 21,6 oziroma 19,2 (meja 8), pri navadnem vidu 32,3 oziroma 29,0 (meja 15), kontrast do podlage povsod nad 3:1.

Blagovna rdeča se v grafih **ne** uporablja kot serija: v aplikaciji pomeni poudarek, na grafu pa mora rdeča pomeniti napako. Če bi bila serija rdeča, bi se pomena mešala.

Za velikost (stolpci, krogi na karti) je zaporedna lestvica enega odtenka, več je temneje. Temna tema ima svoje korake, ne obrnjenih svetlih. Visoki kontrast in črno-belo dobita sivinsko lestvico.

### Interakcija in dostopnost
- Dotik ali miška po časovnici pokaže navpičnico in oblaček z datumom in vrednostjo.
- Gumb v glavi preklopi med **grafi in številkami** — ista vsebina brez barv, za bralnik zaslona in za prepis.
- Napake so rdeče **in** označene z besedo; barva ni nikoli edini nosilec pomena.
- Vse mere se množijo z `--ui-scale`, zato grafi delujejo tudi v načinu za starejše.

### Karta najbolj gledanih postajališč
- Nova razsežnost v štetju: pri klicu prihodov se zabeleži **id postajališča** (blob8, samo pri `GetArrivalsForStopPoint`). Je seštevek po obdobju in ni vezan na napravo ali sejo. Stikalo `BELEZI_POSTAJO` v `worker/src/analytics.js` ga izklopi.
- Polmer kroga raste s korenom števila (ploščina je sorazmerna z vrednostjo), barva je ista zaporedna lestvica, bel obroč loči prekrivajoče se kroge. Dotik kroga pokaže ime postajališča in število pogledov.
- MapLibre se naloži šele, ko so podatki tu, in samo če je kaj za pokazati.

### Nove poizvedbe
`zagoniDnevi`, `zaledjeDnevi` (skupaj, od tega napake, mediana) in `postaje` — vse v `worker/src/stat.js`, kjer so že prejšnje. `sumIf` je v tem narečju podprt.

---

## 0.16.0 — 2026-09-22

Skriti zaslon s statistiko v aplikaciji. Za uporabnika se ne spremeni nič.

### Kje je
Deset dotikov na ime razvijalca v **Nastavitve → O aplikaciji**. Števec se ponastavi, če je med dotikoma več kot sekunda in pol, zato ga drsanje po seznamu ne sproži; pri zadnjih treh dotikih se pokaže odštevanje.

Skrivanje vhoda ni varovalo. Varuje ga ključ: zaslon ob prvem odprtju zahteva geslo, ki se shrani lokalno in pošlje v glavi `x-stat-key`. Napačen ključ pomeni 401 in shranjeni ključ se pobriše.

### Kaj pokaže
Zagoni (nameščena proti brskalniku, različica gradnje, tema, način za starejše), zavihki, uporaba filtra smeri, namestitve, prehodi offline/online in zaledje po dnevih z mediano odzivnega časa. Obdobje se preklaplja med danes, 7 in 30 dni. Zgoraj sta dve številki na prvi pogled: število zagonov z deležem nameščenih ter število klicev zaledja z opozorilom, če je med njimi kakšna napaka.

### Nova pot `GET /stat` na Workerju
- Poizvedbe SQL živijo samo tu, zato se ne morejo razdvojiti med aplikacijo in ukazno vrstico.
- Zaščita: znan `Origin` (isti seznam kot OBA) in ujemanje `x-stat-key` s skrivnostjo `STAT_KEY`, primerjano v času, ki ne izda dolžine ujemanja.
- Žeton za Cloudflarov SQL API in ID računa sta skrivnosti Workerja, zato v aplikacijo nikoli ne prideta — odjemalec vidi samo seštevke.
- Odgovor se minuto hrani v izolatu, ker so branja omejena na 10.000 na dan.
- `GET /health` javi `statConfigured`.

### Preverjeno
- V živo na Workerju: brez ključa 401, napačen ključ 401, pravi ključ vrne vseh šest skupin (zagoni, zavihki, filter, namestitev, omrežje, zaledje); prvi izmerek zaledja 138 klicev OBA z mediano 415 ms in nič napak.
- `npm run check` 0/0, gradnja zelena; zaslon je ločen kos (12 kB), ki se naloži šele ob prvem odprtju.

---

## 0.15.0 — 2026-09-22

Anonimno štetje uporabe. Dva vira, oba na lastnem Cloudflare Workerju — tretje osebe ni.

### Štetje na strežniku
- Worker si ob vsakem klicu OBA in ORS zabeleži metodo, izid, odzivni čas, ali je šlo iz predpomnilnika in ali je teklo prek posrednika. Za to ni potrebna nobena vrstica v aplikaciji in ni nobenega podatka o uporabniku.
- Namen je operativni: napaka 502 na živih prihodih je septembra ostala neopažena več dni, ker je ni nihče meril. Zdaj je vidna v prvi poizvedbi.

### Dogodki iz aplikacije (`POST /ev`)
- Zabeležijo se: zagon (nameščena ali v brskalniku, različica gradnje, tema, način za starejše, jezik naprave), preklop zavihka, uporaba filtra smeri, izid namestitvenega poziva in prehod offline/online.
- Kadar povezave ni, gre dogodek v `localStorage` in se pošlje, ko se povezava vrne. Brez tega bi manjkal ravno tisti del uporabe, ki se dogaja na postaji.
- Namestitveni dogodki na iPhonu ne obstajajo (Apple jih ne podpira); tam je edini signal zagon v načinu »nameščena«.

### Kaj se ne zapisuje
- Koordinate — nikoli, tudi zaokrožene ne. V mestu velikosti Maribora bi zaokrožene še vedno zadoščale za sled.
- Identifikator naprave, naslov IP, imena iskanih postaj.
- Zato ni piškotka in ni privolitvenega okna. Zapiše se dvočrkovna oznaka države, ki jo Cloudflare tako ali tako pozna.

### Kako je zavarovana javna končna točka
- Zahteva mora priti z znanega izvora (isti seznam kot za OBA), biti manjša od 4 kB in vsebovati največ 20 dogodkov.
- Sprejmejo se **samo znana imena dogodkov in samo znane vrednosti razsežnosti** — prosto besedilo se zavrže. S tem ne more uiti noben osebni podatek niti po pomoti, zloraba pa je omejena na izbiro med peščico oznak.
- Zavora 600 dogodkov na minuto na izolat.
- Brez vezave na Analytics Engine štetje tiho ne naredi nič. Analitika ne sme nikoli podreti poti, po kateri tečejo vozni redi.

### Nastavitev in orodje
- V Nastavitvah pod **Podatki** je stikalo »Anonimno štetje uporabe«. Spoštuje se tudi »Do Not Track« v brskalniku.
- `worker/scripts/statistika.mjs` izpiše zagone, zavihke, uporabo filtra, namestitve in stanje zaledja po dnevih. Potrebuje žeton Cloudflare z eno samo pravico (Account Analytics: Read).
- Poraba: brezplačni paket Cloudflare vključuje 100.000 zapisov in 10.000 poizvedb na dan, hramba je tri mesece.

### Drugo
- Iz Nastavitev je odstranjena vrstica »Izvorna koda«.

### Preverjeno
- 24 preverb Workerja v Node (veljavni in zavrnjeni dogodki, prevelik svežnjev, pokvarjen JSON, napačna metoda, manjkajoča vezava, zavora pogostosti) in 26 preverb odjemalca (vrsta brez povezave, 4xx proti 5xx, meja vrste, izklop, Do Not Track, oblika zagona v vseh štirih temah).
- Najpomembnejša preverba: telo, ki ga odjemalec res pošlje, gre skozi Workerjev validator — če se seznama dogodkov kdaj razideta, pade test in ne produkcija.
- V živo po objavi Workerja: `/health` javi `analytics: true`, veljaven dogodek 204, neznan 202, zahteva brez znanega izvora 403, klic OBA še vedno 200 v 0,10 s.

---

## 0.14.0 — 2026-09-21

Način za starejše. Vklopi se v Nastavitvah pod **Izgled** in se kombinira s katerokoli temo.

### Zakaj ni samo večja pisava
Starost prinese troje hkrati: manjšo ostrino vida, upad občutljivosti za kontrast in manj natančen prst. Zato gredo skupaj večje besedilo, kontrast 7:1 (WCAG 1.4.6 AAA), večje tarče z razmikom med njimi (WCAG 2.5.5) in manj vsebine na zaslon.

Pri izdelavi vzorca se je pokazalo, zakaj samo povečava ne zadošča: pri +50 % se cel opis linije (»Pobreška Europark - Univerzitetni kampus - Kamnica«) razlomi v **pet vrstic** in vrstica zraste na **173 px**. Rešitev ni manjša pisava, ampak manj besedila.

### Kaj se spremeni, ko je način vklopljen
- **Besedilo +50 %** prek nove spremenljivke `--ui-scale`, ki množi celotno lestvico iOS HIG. Cilj 16 → 24 px, ime postaje 18 → 27 px, drobni tisk 13 → 20 px. Nobeno besedilo ni več manjše od 16 px.
- **Cilj namesto opisa linije.** V ospredju je končna postaja (»Kamnica«), vmesne so v drobnejši vrstici pod njo (»prek Pobreška Europark, Univerzitetni kampus«). Končna postaja se vzame iz **zadnje postaje vožnje** v voznem redu, ne iz razreza opisa; za žive prihode iz OBA, kjer vožnje ne poznamo, ostane razrez zadnjega dela opisa.
- **Večje tarče z razmikom.** Vrstica odhoda najmanj 64 px (izmerjeno 80 px), značka linije 36 → 44 px, gumba »V center«/»Iz centra« 44 → 56 px, med vrsticami 8 px praznine namesto skupne črte — sosednji tarči brez presledka zgreši vsak tresoč prst.
- **Kontrast po AAA.** Pridušeno besedilo `#6E6E73` → `#4F4F54` (8,14:1), poudarek `#D32027` → `#A8181E` (7,46:1), »na voznem redu« `#177A37` → `#0F5D25` (8,04:1), zamuda `#A85700` → `#7E4100` (7,94:1). V temni temi `#8E8E93` → `#AEAEB2` (7,69:1).
- **Manj na zaslonu.** Pet postajališč namesto osmih, dva odhoda na kartico namesto treh. Dolg seznam pri veliki pisavi zahteva le več drsenja.
- **Spodnja vrstica raste z besedilom** (60 → 76 px, izmerjeno 87 px z dvovrstičnim napisom »Vozni redi«), ikone 23 → 30 px.
- Naslov z vremenom in naslov razdelka z oznako »V živo« se postavita eden pod drugega, ker se pri veliki pisavi stiskata v dva ozka stolpca.

### Popravek, ki velja za vse
- **Zelena za »na voznem redu« je bila pod mejo AA.** `#1B8A3F` ima na beli podlagi 4,42:1, meja pa je 4,5:1 — komentar v kodi je ob uvedbi trdil nasprotno. Zdaj `#177A37`: 5,42:1 na beli in 4,86:1 na `surface-2`.

### Preverjeno
- Privzeto stanje nespremenjeno: lestvica 1, osem kartic po tri vrstice, cilj 16 px, vrstica 56 px, spodnja vrstica 62 px, cel opis linije. Po izklopu se vse vrne v to stanje.
- Vklopljeno: lestvica 1,5, pet kartic po dve vrstici, cilj 24 px, ime postaje 27 px, drobni tisk 20 px, vrstica 80 px, značka 44 px, gumb 56 px, spodnja vrstica 87 px, cilj »Kamnica« + »prek Pobreška Europark, Univerzitetni kampus«.
- Brez vodoravnega drsenja pri 390 in 320 px, napisi v spodnji vrstici niso obrezani, temna tema dobi svojo pridušeno barvo (`senior dark`), `npm run check` 0/0, gradnja zelena, 0 napak v konzoli.

---

## 0.13.0 — 2026-09-21

Videz po iOS 27 in nov način iskanja odhodov proti središču mesta.

### Spodnji meni po iOS 27
- Meni **lebdi nad vsebino** kot zaobljena kapsula (10 px od roba, višina 60 px, radij 28 px) namesto neprosojne ploskve od roba do roba. Vsebina teče pod njim; na karti se spodnji del mesta ne izgubi več.
- Površina je steklena: `backdrop-filter: blur(28px) saturate(180%)` z nizko prosojnostjo (0,80 v svetli, 0,78 v temni temi), temnejšim robom in tankim odsevom na zgornjem robu. Nizka prosojnost je namerna — Apple jo je pri iOS 27 glede na iOS 26 zmanjšal prav zaradi berljivosti.
- Pod aktivnim zavihkom je obarvana kapsula.
- **Brez nove odvisnosti.** Knjižnice, ki posnemajo lom svetlobe prek SVG filtrov v `backdrop-filter`, na iPhonu ne delujejo — WebKit tega ne podpira in učinek se sesede na navaden blur.

### Varovala za dostopnost
- `@supports`: kjer brskalnik `backdrop-filter` ne pozna, ostane polna ploskev.
- `prefers-reduced-transparency: reduce`: kdor ima v sistemu vklopljeno zmanjšano prosojnost, dobi meni brez stekla.
- Temi **kontrast** in **črno-belo** ostaneta neprosojni — steklo je proti njunemu namenu.

### Mere menija na enem mestu
- Nove spremenljivke `--tabbar-h`, `--tabbar-gap` in `--tabbar-space` v `app.css`. Vse, kar stoji nad menijem (vsebina zaslonov, gumbi na karti, obvestila, poziv za posodobitev), računa razdaljo iz njih. Prej so bile razdalje raztresene po petih datotekah kot 5rem, 5,5rem, 9,5rem, 6,5rem in 84 px.

### V center / Iz centra
- Na Domu sta pod »Kam greš?« dva nova gumba. **»V center«** pokaže samo postajališča, s katerih avtobus pelje proti središču — Glavni trg ali Avtobusna postaja kot ena od **naslednjih** postaj. **»Iz centra«** je zrcalno: center je na tej vožnji že mimo. Ponoven klik filter izklopi.
- Filtrirajo se tudi posamezne vrstice odhodov, ne le postajališča; kartica brez odhoda v izbrano smer odpade. Če v bližini ni ničesar, prazno stanje ponudi »Pokaži vse odhode«.
- Krog kandidatov za bližnja postajališča je razširjen z 20 na 40 najbližjih — filter jih veliko odreže in seznam bi se sicer skrčil na dve kartici.
- Odhodi se presejejo **pred** rezom na tri, sicer bi bila kartica prazna vedno, kadar prvi trije odhodi peljejo v napačno smer.

### Kako se prepozna smer
- Središče je določeno po **imenu** postajališča (`Glavni trg`, `Avtobusna postaja`), ne po id-ju — id-ji se ob novem feedu lahko premaknejo, imeni pa sta stabilni.
- Pri krožnih linijah, ki center obiščejo večkrat, štejeta prvi in zadnji obisk: pred zadnjim center še pride, po prvem je že mimo. Zato je tak odhod lahko upravičeno v obeh načinih.
- Odhod iz voznega reda se odloči po **točnem ključu** (linija + opis smeri). Živ prihod iz OBA nosi svoj `LineDescription`, ki se z opisom iz voznega reda ne ujame vedno, zato zanj velja rezerva po liniji. Brez te ločnice je na Dogošah, kjer P16 z istim id-jem vozi v obe smeri, isti odhod padel v oba načina.

### Preverjeno
- Indeks smeri proti surovemu prehodu vseh 456 postajališč: 0 razhajanj (244 v center, 241 iz centra, 78 oboje, 49 nobeno).
- 36 vrstic, ki jih je aplikacija pokazala pri torkovih 08:00 (ura ponarejena v brskalniku, ker ob 23h vozni red nima odhodov), neodvisno potrjenih 36/36.
- Geometrija 10/10/10 px, tarča za dotik 74 × 60 px pri 390 px in 60 × 60 px pri 320 px, brez preliva napisov in brez vodoravnega drsenja pri 320, 390 in 1024 px.
- `npm run check` 0/0, gradnja zelena, 0 napak v konzoli.

---

## 0.12.0 — 2026-09-20

Pot nazaj s karte. Izbereš postajo, vidiš prihode, odpreš avtobus — in se vrneš na isto postajo.
Ob tem sta odkriti dve napaki, ki sta ta korak doslej onemogočali.

### Vrnitev na postajo
- V podrobnostih avtobusa je nov gumb **»Nazaj na postajo«** z imenom postaje, s katere je uporabnik skočil. Isto naredi sistemski gumb nazaj. Gumb X zapre vse, kot prej.
- Postaja se zapomni pri obeh poteh do avtobusa: iz seznama prihodov in ob dotiku vozila na karti. Ko se uporabnik iz avtobusa premakne na njegovo naslednjo postajo, se spomin počisti.

### Podrobnosti avtobusa se sploh niso odprle
- **Dotik avtobusa v seznamu prihodov je list takoj zaprl.** Izbira avtobusa počisti izbrano postajo, reaktivni blok ob prazni postaji pa list zapre — in se izvede po tem, ko ga je izbira avtobusa ravnokar odprla. Uporabnik je videl avtobus na karti brez vsakršnih podatkov. Zdaj se list zapre samo, kadar hkrati ni izbran avtobus. Izmerjeno: list je bil zamaknjen za celotno višino (776 px).

### Sistemski nazaj je vrgel iz aplikacije
- **`backstack.ts` je ob zapiranju vmesnega vnosa preklical napačen korak v zgodovini.** `history.back()` prekliče zadnji vnos, ne tistega, ki se zapira. Ko se je iskanje postaje zaprlo šele po tem, ko je izbrana postaja že potisnila svoj vnos, je odstranilo tujega. Brskalnik je ostal korak pred aplikacijo in naslednji »nazaj« je zapustil stran (prazen zaslon).
- Popravek: sentinel se odstrani samo, kadar je vnos na vrhu sklada. Odvečni vnos, ki ostane, požre en pritisk nazaj, kar je neopazno — modul to možnost že navaja kot sprejemljivo.
- Napaka je bila v produkciji že prej; odkrita je bila ob merjenju te spremembe.

---

## 0.11.1 — 2026-09-20

Predelane Nastavitve: več prostora med skupinami in vrsticami, razločnejši naslovi.
Brez sprememb v delovanju.

### Razmiki in berljivost
- Razmik med skupinami nastavitev 24 → 32 px, vrstice 56 → 60 px z navpičnim robom, razmik med ikono in besedilom 12 → 14 px, podnaslov dobi zrak pod naslovom.
- Naslovi skupin (IZGLED, DOM, KARTA …) so polkrepki in imajo večji razmik med črkami, da se ločijo od vsebine kartice.
- Segmentirani izbirniki (privzeti zavihek, prikaz odhoda, vrsta karte) imajo več notranjega prostora in večji razmik med gumbi.

### Stikala so bila premajhna tarča
- **Vseh pet stikal meri 48 × 28 px, kar je pod mejo 44 px za zanesljiv dotik.** Tarča je razširjena na 66 × 45 px z nevidnim `::after` (razred `mm-tap44`), ne z odmikom — odmik bi premaknil gumbek, ki je postavljen absolutno glede na gumb. Videz stikala ostane enak.
- Preverjeno z merjenjem dejanske tarče prek `elementFromPoint`, ne iz slogov: vseh pet vrne 45 px, vsa še vedno preklopijo stanje.

---

## 0.11.0 — 2026-09-20

Dve novosti v Nastavitvah, v novem razdelku **Deli in predlagaj**. Brez sprememb v podatkih ali voznih redih.

### Deli aplikacijo
- Nova vrstica v Nastavitvah pošlje povezavo do aplikacije (`https://m1984m.github.io/MoHa-Mobil/`) prek sistemskega lista za deljenje — WhatsApp, SMS, pošta, kar ima uporabnik na napravi.
- **Naslov je trdo zapisan na produkcijski URL, ne na `location.href`.** Iz razvojnega strežnika ali z lokalnega naslova bi prejemnik dobil povezavo, ki je ne more odpreti.
- Kjer Web Share API ne obstaja (večina namiznih brskalnikov), se povezava kopira v odložišče in pokaže se obvestilo »Povezava kopirana«. Če odložišče ni na voljo (nevaren kontekst), se povezava izpiše v obvestilu, da jo uporabnik vsaj vidi.
- Zaprtje sistemskega lista (`AbortError`) se ne šteje za napako in ne sproži nadomestnega kopiranja — sicer bi preklic deljenja tiho kopiral povezavo.

### Predlagaj izboljšavo
- Nova vrstica odpre pripravljeno elektronsko sporočilo razvijalcu (`matej.moharic@gmail.com`) z zadevo »MoHa Mobil — predlog izboljšave«.
- **Telo sporočila samodejno nosi različico aplikacije, datum voznega reda in oznako naprave.** Brez teh podatkov predlog pogosto ni razumljiv — npr. prijava »gumba ni« z različice, ki jo naprava še drži v predpomnilniku.
- Izvedeno kot navadna povezava `mailto:`, ne kot obrazec: deluje tudi iz PWA na začetnem zaslonu in ne potrebuje strežnika.

---

## 0.9.5 — 2026-09-07

Šolski vozni red in popravek skritega opozorila. Aplikacija je bila od 01.09. brez delavniških odhodov.

### Šolski vozni red iz vmesnika OBA (`scripts/fetch-gtfs-oba.mjs`, `npm run gtfs:oba`)
- **Uradni `gtfs.zip` je 07.09. še vedno nosil poletni feed** (delavniška služba potekla 31.08.), Marpromov vmesnik OBA pa je šolsko obdobje 04.09.–31.12.2026 že stregel. Nova skripta iz OBA (`GetLines`, `GetRoutes`, `GetStopPointSheduleForLine`, `GetTrips`) sestavi GTFS v enaki obliki kot uradni feed: isti `stop_id`, `route_id` in `direction_id` po smeri, zato priljubljene postaje in linije preživijo.
- **Vožnje se verižijo po postajah** — OBA odhode pozna samo po postaji in smeri, ne po vožnji. Na začetni postaji mora biti odhod točno ob času vožnje (loči različice z istim začetkom in koncem, npr. G4 z Lesarsko šolo ali brez), naprej se vzame najzgodnejši še neporabljen odhod. Končna postaja v OBA nima odhoda: čas je mediana zadnjega odseka iz uradnega feeda po vrsti dneva, liniji in smeri; OBA-jeva končna »Avtobusna postaja« 457 se preslika na uradno 192.
- **Preverjeno proti uradnemu feedu na soboti in nedelji, ki se nista spremenili:** brez končne postaje se ujema 565/565 sobotnih in 322/322 nedeljskih voženj (razlike so samo tam, kjer se je vozni red res spremenil — G5 in P10 ter tri nove pozne vožnje G1/G3), s končno postajo 564/565 in 322/322 (ena sobotna vožnja P11 ima v uradnem feedu zadnji odsek 4 min namesto 3). 0 neporabljenih odhodov, 0 nazadujočih časov.
- Pregled vseh dni v obdobju (prazniki, počitnice) zapiše izjeme v `calendar_dates.txt`; dneve z neznanim redom izpiše.

### Opozorilo o zastarelem voznem redu
- **`feedCoversDate` je štel, da je feed veljaven, če ga pokriva katerakoli služba.** Sobotna in nedeljska sta veljali do 31.12., zato je bilo opozorilo ob ponedeljkih skrito, seznam pa prazen. Zdaj šteje samo služba, ki ta dan res vozi (dan v tednu + izjeme), besedilo pove »Za danes ni voznega reda«.

---

## 0.9.4 — 2026-08-27

Popravek uvoza voznega reda. Brez sprememb v vmesniku.

### Sanacija okvarjenih časov v GTFS
- **Vožnja `96328` (G5) je imela na postajališču Kamnica čas `00:00:00` sredi vožnje 09:50–10:08** — en zapis od 35.397 v Marpromovem feedu, a je pomenil odsek z negativnim časom vožnje −10,1 ure. Posledici: načrtovalnik poti je lahko sestavil pot, ki »prispe pred odhodom«, na Kamnici pa se je lahko pokazal odhod ob 00:00. Uvoz zdaj čas interpolira med sosednjima veljavnima postankoma (rezultat: **10:07**), postanek pa ohrani.
- **`scripts/build-gtfs.mjs` preverja, da časi vzdolž `stop_sequence` ne nazadujejo.** Za resnico velja najdaljše nepadajoče podzaporedje časov v vožnji; kar pade ven, je napaka. Zamejen postanek se interpolira in zaokroži na minuto (feed je minutno kvantiziran), nezamejen (prvi ali zadnji v vožnji) se izpusti — časa si uvoz ne izmišlja.
- **Vsak poseg se izpiše** skupaj s kontaktom za prijavo (`marprom.transit@gmail.com`), `public/gtfs/meta.json` pa nosi števec `anomalies` (0 = čist feed), da se napaka v prihodnjem feedu opazi tudi ob samodejnem prevzemu.
- Preverjeno na sintetično pokvarjenem feedu (prvi postanek, zadnji postanek, dva zaporedna sredi vožnje): vseh 5 primerov ujetih, po popravku 0 nazadujočih razmikov. Na resničnem feedu spremenjena natanko 1 vožnja, izgubljenih postankov 0.

> Opomba: različice 0.9.1–0.9.3 v tem zapisu niso dokumentirane — objavljene so bile brez vnosa v changelog.

---

## 0.9.0 — 2026-07-30

Revizija UX/UI po celovitem pregledu (koda + živ test v brskalniku). Poudarek: berljivost časov, dostopnost in povratna sporočila uporabniku.

### Prikaz časov (enoten sistem, `src/lib/time.ts`)
- **Čas do odhoda se pretvori v ure oz. uro odhoda.** Prej je seznam odhodov izpisoval surove minute — ponoči je pisalo »296 min« namesto »05:11«. Pravilo: < 60 min → minute, 60–180 min → »2 h 15«, ≥ 180 min → ura odhoda. Velja na Domu, v Priljubljenih in v postajnem pogledu na Karti.
- **Odštevalnik »Kreni«** se skrije, ko je do odhoda več kot 30 minut (prej je pisalo »Kreni 277 min« v zeleni barvi, kar ni imelo vsebine).
- **»Danes ni več odhodov« ni več slepa ulica** — poišče se prvi odhod naslednjega dne s prometom (do 7 dni naprej, pokrije praznike in nedelje) in se prikaže z uro, linijo in smerjo.
- Vse pretvorbe časa so v enem modulu; prej so v isti kartici obstajali trije neodvisni formati.

### Napake in nedoslednosti
- **Privzeta tema je zdaj »Samodejno«** (prej trdo »Svetla«) — telefon v nočnem načinu je ponoči na postaji dobil bel zaslon.
- **Escape zapre vozne rede.** Poslušalec je bil na `div`-u, ki ni nikoli dobil fokusa; prestavljen na `<svelte:window>` (postajni in linijski vozni red, izbirnik linij).
- **Sistemski gumb »nazaj« na zavihku Vozni redi** zapre vozni red namesto aplikacije — ta zaslon je bil edini brez vezave na `backstack`.
- Slovnica: »Velja od **julija** 2026« (prej imenovalnik »julij« iz `Intl`).
- Popravljen manjkajoč presledek v »67 m stran · s227«.
- **»Počisti vse podatke« zdaj ponastavi tudi temo** — ključ `mmob-theme` se ne drži predpone `mm.` in je bil spregledan.
- Odstranjen diagnostični `console.log` ob vsakem pollu živih vozil.

### Povratna sporočila in nadzor
- **Razveljavitev brisanja** (skupen toast z gumbom »Razveljavi«): poteg v stran na priljubljeni postaji (vrne tudi pripete linije), brisanje shranjene poti, »Počisti« vse priljubljene.
- **Domači `confirm()` zamenjan** z lastnim potrditvenim oknom (priljubljene, brisanje podatkov).
- **Shranjene poti je mogoče preimenovati** (»Dom → Služba«) — funkcija je obstajala v shrambi, a je ni klical noben zaslon.
- **Opozorilo, ko pešpoti niso na voljo** — ob izpadu/kvoti ORS so časi hoje ocenjeni po zračni razdalji; načrt poti to zdaj pove namesto tihega podcenjevanja.

### Načrtovalec in karta
- **Predlogi v načrtovalcu se ne odrežejo več** — spustni seznam je bil absolutno pozicioniran znotraj vsebnika z `overflow-y: auto`, zato je bilo od 6 zadetkov vidnih 2,5.
- **Iskanje postaje po imenu na Karti** (lupa zgoraj desno) — prej je bil edini vstop tap po pikici na zemljevidu.
- Postajališči z istim imenom (par čez cesto) sta na Domu ločeni z namigom o smeri.
- Utripajoča zelena »živa« pika miruje in posivi, kadar podatki niso živi (prej je utripala tudi ob napisu »Po voznem redu«).

### Dostopnost
- Kartica postaje na Domu je razbita na naslovni gumb + gumbe po vrsticah; prej je bila en sam `<button>`, ki ga je bralnik zaslona prebral kot eno nerazumljivo oznako.
- Ujetje fokusa v modalih (`use:focusTrap`) + vračanje fokusa na element, ki je modal odprl.
- `aria-live` na kartici »Čakanje«, da bralnik javi osvežen čas.
- Vse okrogle tarče dotika povečane na 44 px (prej 36–40 px); naslov postaje in akcije v svojih vrsticah, da se dolga imena ne obrezujejo.
- Odseki dobili prave naslove (`<h2>`), pripis © Esri za satelitsko podlago, povezava na izvorno kodo.

### Notranje
- Nova skupna komponenta `StopBoard.svelte` — Dom je prej imel dva identična bloka za bližnje in priljubljene postaje (~35 vrstic podvojene predloge).
- Nova modula `lib/time.ts`, `lib/toast.ts`, `lib/focusTrap.ts`; novi komponenti `ui/Toast.svelte`, `ui/ConfirmDialog.svelte`.

## 0.8.1 — 2026-07-23

Posodobitev voznega reda + orodje za samodejni prevzem GTFS.

### Podatki
- **Nov GTFS feed Marprom (velja 06.07.2026 – 31.12.2026).** Prejšnji feed je potekel 25.06.2026, aplikacija je torej ~4 tedne prikazovala zastarele vozne rede.
- Poletni vozni red: 454 → **457 postaj**, 2.067 → **1.833 voženj**, 39.714 → **35.397 postankov**; linije (G1–G6, P7–P19) nespremenjene.
- ⚠️ Delovni servis v tem feedu velja **samo do 31.08.2026** (sobota/nedelja do 31.12.). Šolski vozni red Marprom objavi konec avgusta — takrat je nujen nov prevzem.

### Orodja
- Nov `scripts/fetch-gtfs.mjs`: prenese `vozniredi.marprom.si/gtfs/gtfs.zip`, razpakira (lasten minimalni ZIP reader, brez odvisnosti), naredi varnostno kopijo prejšnjega feeda in namesti novega. `npm run gtfs` = prevzem + build, `npm run gtfs:check` = samo preverjanje.
- Opozorilo pred potekom se računa **po dnevih v tednu iz `calendar.txt`**, ne iz `feed_end_date` — sicer bi trenutni feed izgledal veljaven do 31.12., čeprav delavniki potečejo 31.08.

## 0.8.0 — 2026-06-12

Celovita revizija (analiza: design / UX tokovi / podatkovni tokovi / točnost podatkov / PWA) + popravki.

### Točnost podatkov
- **Indikator svežine živih podatkov zdaj dejansko deluje.** `liveStaleSec` se je prej nastavil samo ob uspešnem pollu (vedno ~0) — dodan sekundni ticker; "pred X s" v živo raste, ob izpadu OBA pa se po 90 s vozila samodejno preklopijo iz zamrznjenih GPS pozicij na sintetične (vozni red).
- **Krožne linije:** trip, ki gre skozi isto postajo dvakrat, je prej v odhodih/voznih redih pokazal samo prvi obisk (`upcomingDepartures`, `allDeparturesForStop`, `LineTimetableModal`) — zdaj se upoštevajo vsi obiski (158 tripov v feedu).
- **Bus detail se osvežuje v živo:** `selectedLive`/`selectedVehicle` se sinhronizirata z vsakim pollom (prej zamrznjena na stanju ob tapu), odštevalnik v "Naslednje postaje" in trip-match se osvežujeta s 30 s tickom.
- **Stari živi prihodi na Domu** veljajo 2 min od zadnjega uspešnega fetcha, potem fallback na GTFS (prej so ob izpadu večno prekrivali sveže podatke).
- "Velja od februar 2026" zamenjan z datumom iz `meta.json` + opozorilo, ko service obdobja v feedu potečejo (trenutni feed se izteče 2026-06-25!).
- Polnočna normalizacija delayMin fallbacka; vremenski urni graf med 00:00–01:59 ni več prazen (UTC/lokalni datum); "Kreni" uporablja nastavitev hitrosti hoje (prej hardkodiranih 1,3 m/s).
- Klik na živ prihod odpre vozni red linije v pravi smeri (prej vedno smer 0); opomba pod bus pogledom loči GPS bus od sintetičnega.

### UX
- **Sistemski "nazaj" (Android/brskalnik) zapira modale in izbire namesto izhoda iz aplikacije** — nov `backstack.ts`, ožičeno: planer, vreme, postaja, plan, bus, vozni redi, share, pripni linijo.
- Tap na shranjeno pot / deep link: indikator "Iščem pot…" + ob neuspehu se odpre planer s prednastavljenim ciljem (prej tiho nič).
- Razčlenjena sporočila planerja (čas v preteklosti / predaleč od postaj / ni povezave ob času); pike na gumbu se animirajo.
- Tap v polje planerja ne razveljavi več izbranega kraja (razveljavi šele sprememba besedila); geocode predlogi imajo seq-token (out-of-order odgovori).
- Tap na karto zapre tudi izbran bus (prej samo postajo); dvojina "čez 2 minuti".

### Stabilnost
- `MapView`: async `onMount` je vračal cleanup, ki ga Svelte ignorira → MutationObserver leak + `setStyle` na uničeni mapi; mapa se ni smela ustvariti po unmountu (WebGL leak); kamera ukazi pred pripravljeno mapo se zdaj uvrstijo namesto izgubijo; po menjavi stila se overlay plasti dodajo z retry (prej so lahko trajno izginile).
- `MapScreen`: napaka shapes.json ne ugasne več živega pollinga; seq-guard za hitri preklop postaj; identity-guard za shape izbranega busa; RAF guard za `activePlan`; odстranjeni non-null asserti na GTFS poteh.
- Schema validacija `savedRoutes` + sanacija `walkSpeedKmh` iz localStorage; `decodeURIComponent` guard za pokvarjene share linke.
- Polling se ustavi, ko gre app v ozadje (`visibilitychange` v realtime.ts + guardi v Home/MapScreen) — baterija, podatki, proxy kvota.

### PWA / verzije / deploy
- **`npm run deploy` je obšel `build-sw.mjs`** (gh-pages je dobival zastarel `sw.js` — na produkciji `0.7.9-a2fcb4e` ob HEAD `7898646`) → `predeploy: npm run build`.
- **En vir verzije:** `release.ts` bere `__APP_VERSION__` iz package.json (prej: package.json 0.7.9, release.ts 0.7.4, sw.js tretja).
- SW: hashirani `/assets/` cache-first (prej SWR re-prenos ~430 KB gzip ob vsakem zagonu); glyph fonti pokriti za offline; tiles cache omejen na 500 vnosov.
- `theme-color` in `color-scheme` sledita temi (status bar v temni temi ni več rdeč; native elementi tematski).

### Design / dostopnost
- LineBadge: barva teksta po luminanci ozadja (bel tekst na lime/oranžni < 2:1); svetla tema: temnejši `--status-*` in `--text-muted` (WCAG kontrast za "zdaj"/zamude/footnote).
- Globalni `:focus-visible` indikator; modali: Escape + `role=dialog`/`tabindex` (PlannerModal prej brez role); UpdateToast upošteva safe-area (notch); popravljen `t-largetitle` typo (vreme); seznami v karticah Doma brez `<ul>` v `<button>` (neveljaven HTML).
- Počiščeno: mrtva `SearchScreen.svelte`, neuporabljen `public/icons.svg`, mrtvi design tokeni (modra brand paleta).

## 0.7.4 — 2026-04-21

### Novosti
- **Krožna navigacija med prikazi.** Uporabnik lahko zdaj brez slepih ulic kroži: Dom → postaja → linija → postaja → linija → … Konkretno:
  - **Bus detail → klik na vrstico v "Naslednje postaje"** zapre bus detail in odpre postajni pogled za tisto postajo (flyTo, žive prihode, filter linij) — prej je bila lista zgolj informativna, tap ni naredil ničesar.
  - **Vozni red linije → "Odpri postajo" ikona** (ExternalLink) ob izbrani postaji v `LineTimetableModal`. Zapre modal in odpre Karto → postaja. Deluje tako iz Karte (bus detail) kot iz zavihka Vozni redi.
  - **Vozni red postaje → klik na LineBadge chip v uri** (`StopTimetableModal`) zapre stop modal in odpre vozni red tiste linije (s pravo smerjo `trip.dir`). Deluje v obeh kontekstih (Karta, Vozni redi).
- **Zavihek Vozni redi — klik na postajo po imenu** zdaj poleg `StopTimetableModal` odpre tudi Karta → postaja skozi `onOpenStop` pot iz `LineTimetableModal`, tako da je izhodišče iz obeh zavihkov usklajeno.

### Tehnično
- `LineTimetableModal`: nov opcijski `onOpenStop: (stopId) => void` prop. Ko je podan, se v selected-stop headerju prikaže ExternalLink ikona (accent barva, poleg Star fav gumba).
- `StopTimetableModal`: nov opcijski `onOpenLine: (routeId, dir) => void` prop. Ko je podan, se LineBadge chip-i v urnem pregledu rendirajo kot `<button>` namesto `<div>`, s pravilnim `trip.dir` iz `grouped`.
- `MapScreen`: nova helper funkcija `jumpToStopFromBus(s)` počisti `selectedLive/followBus` in delegira `handleStopChange` preko `onStopChange(s)` (ki že počisti `selectedVehicle` in sproži flyTo/refreshArrivals/fitBounds).
- `TimetablesScreen`: nov `onStopSelect: (s: Stop) => void` prop (routed iz App.svelte → `handleStopSelect` → activeTab='map' + selectedStop), hrani `lineDir` state za `initialDir` propagation.
- App.svelte prop threadanje: `<TimetablesScreen onStopSelect={handleStopSelect} />`. Brez `handleStopSelect` v TimetablesScreen-u je bilo onemogočeno jumpanje iz Linije → postaja iz tega zavihka.

## 0.7.9 — 2026-04-20

### Popravki (kritični)
- **Enoten vir ETA za avtobusne podrobnosti.** Prej je top card v bus detail-u kazal `selectedLive.etaMin` iz `/GetActiveDeviceDetails`, postajni pogled pa `a.ETAMin` iz `/GetArrivalsForStopPoint` — dva neodvisna OBA endpointa lahko vrneta različni vrednosti (npr. bus #161 P8: "prihaja zdaj" v linijskem, "čez 72 min" v postajnem). Zdaj bus detail ob izbiri kliče `fetchArrivalsForStopPoint(nextStopPointId)` in filtrira po `busCode` → uporabi **isto** vrstico kot postajni view. Auto-refresh 15 s. Poleg ETA zdaj prikaže tudi `delayMin` (+zamuda zelena/rdeča).
- **Dom zavihek zdaj v živo.** Prej je `HomeScreen` za vsako postajo klical GTFS `upcomingDepartures()` — čist vozni red brez zamud, ne-ujema se z OBA podatki v postajnem pogledu (ista postaja: Dom kaže 14 min, Postaja 9 min). Zdaj ob mount-u in vsakih 30 s paralelno fetcha `fetchArrivalsForStopPoint` za vse vidne postaje (bližnja ∪ priljubljena), dedup po stopId. Ko OBA vrne podatke → Dom kaže iste etaMin kot postajni view. GTFS scheduled ostane fallback (OBA fail ali ni več živih prihodov). Reactive watcher na `stopIdsKey` sproži nov fetch tudi ob premiku uporabnika ali spremembi priljubljenih.
- **Ikona busa sledi zadnjemu OBA GPS.** Odstranjena GTFS schedule + anchor hibridna interpolacija v `realtime.ts` (`interpolate()`, `rafLoop`, `vehiclePaths`, `anchors`, `scheduleS`, `projectToPoly`, `pointAtS`, `setVehiclePaths`, `setVehicleShapes` → vse zbrisano). Ikona se zdaj postavi direktno na `v.lat/v.lon` iz zadnjega polla. Bearing se računa iz `prev→cur` GPS premika v metrih (cache ob mirovanju, da ikona ne skače). Povzročitelj drift-a (schedule "napredovanje" kljub stoječemu GPS-u) odstranjen.
- **Odstranjena eksperimentalna gladka animacija.** `smoothVehicleMotion` setting, stikalo v Nastavitvah in povezan RAF loop zbrisani. Vrnemo se, ko bo Marprom GPS cadence boljši.
- **Odstranjen `findTripBatch` batch per poll.** Prej po vsakem polle MapScreen matchal vse žive buse → GTFS trip → shape + stopSeq, pošiljal v realtime za schedule interpolation. Ni več potrebno; `findTripForLiveBus` ostane, kliče se samo ob izbiri busa (za `vehTrip` / prikaz trase).

### Drobni popravki
- **Statična oznaka voznega reda na Domu.** "Vozni red velja od: {datum}" (dinamično iz meta.json, sl-SI format) → "Velja od februar 2026". Datum se ne spreminja dovolj pogosto, da bi bil dinamičen prikaz smiseln; uvoz `GtfsMeta` + `loadMeta` + `Intl.DateTimeFormat` iz `HomeScreen` odstranjen.

## 0.7.0 — 2026-04-20

### Novosti
- **Sledenje lokaciji v živo (`watchLocation`).** Moder pin uporabnika se zdaj avtomatsko posodablja med gibanjem (high-accuracy GPS, cache 5 s). Stikalo v Nastavitvah (privzeto ON). Ob preklicu pravic (`err.code === 1`) watch avtomatsko odjavi, da ne vrtimo prazen zahtevek.
- **Gladko premikanje busov — beta, privzeto OFF.** Nova nastavitev `smoothVehicleMotion` (v Nastavitvah pod Karto, oznaka "beta"). Ko je OFF, bus "skoči" vsakih 30 s na novo GPS pozicijo (poceni, deterministično). Ko je ON, animacija teče po voznem redu + OBA anchor offset (RAF). Razlog za OFF privzet: interpolacija pri dolgi razliki med poll-om in GPS fresh-om občasno "prehiteva", kar je pri beta testu večje motenje kot suhi preskoki.
- **Datum veljavnosti voznega reda na Domačem zaslonu.** Pod pozdravom je nova vrstica "Vozni redi: DD. MMM YYYY" (iz `meta.json`, sl-SI format). Uporabniki pogosto ne vedo, ali delajo s svežimi ali starimi GTFS podatki; zdaj je to eksplicitno.

### Popravki
- **Poll interval 30 s (prej 8 s).** Marprom GPS posodobitve so v praksi ~60 s. 8 s je bil wasteful — isti GPS se je vračal 7× zapored. 30 s ujame prvo svežo pozicijo v povprečju 15 s po Marprom update-u. Manj bandwidth-a, manj pritiska na proxy-je.
- **OBA proxy fallback chain.** Če `corsproxy.io` odpove (429/5xx/timeout), se zahteva avtomatsko rotira na `api.allorigins.win` (in obratno). Sticky izbira — uspešen proxy ostane trenutni. 4 s timeout per proxy. Custom proxy (`VITE_OBA_PROXY`) obdrži no-fallback obnašanje (uporabnik ima svoj nadzor, ne želi, da gre zahteva mimo njegovega endpointa).
- **Hitrejši prvi render karte — paralelni prefetch `shapes.json` (~800 KB).** Prej se je shapes.json fetchal šele ob prvem klicu `loadShapes()`, ki ga MapScreen sproži po mount-u → dodaten round-trip. Zdaj gre v ozadje hkrati z ostalimi GTFS fetch-i v `loadGTFS()`. Swallow-catch: GTFS uspeh ni odvisen od shapes. Odreže ~300–800 ms na 4G.
- **Retry za `loadShapes()` ob transientni napaki.** Ob network fail se `shapesLoading` promise zdaj počisti, tako da naslednji klic požene nov fetch (prej so vsi dobili isti rejected promise → zemljevid trajno brez tras). Isti vzorec kot že obstoječi `loadGTFS`.
- **≥60 % hitrejši match vozil z GTFS trip-i.** Nov `precomputeVehiclesIndexes(gtfs, when)` vrne `{ stopById, tripsByRoute, activeServices, routeIdByShort, dayKey }` v WeakMap<GTFS> cache-u. Prej je vsak klic `findTripForLiveBus` linearno skeniral 14k+ trip-ov in rebuildal `stopById` Map — pri 15+ vozilih preko 5 ms per klic. Zdaj razrez po routeId je O(#trip-ov na linijo) ≈ 50–200. Day-key check sproži rebuild ob polnoči (drugačen aktivni servis).

---

## 0.6.2 — 2026-04-19

### Popravki
- **Krožna linija G3: odpravljen "preskok" ikone busa mimo postaj, ki v ETA še ni prikazan.** Uporabnik je opazil: bus na karti pelje skozi postajo, a če tapne postajo, pove "20 min". Razlog so bili štirje medsebojno povezani bugi, aktivni samo na tripih, kjer sta prva in zadnja postaja isti fizični stop (pts[0] koordinate = pts[N-1] koordinate na shape polyline):
  1. **`projectToPoly` dvoumnost pri zaključku zanke.** GPS blizu depoja se je projeciral na s ≈ 0 (prvi segment zmaga pri strict `<` primerjavi), čeprav bus dejansko zaključuje zanko pri s ≈ totalM. Posledica: `anchor.s` je teleportiral z ~5000 m na 0, `scheduleS()` je vrnil freeze-vrednost na začetku urnika, čas bus-a se je zamrznil → ikona je "pobegnila" v linearni ekstrapolaciji od schedule-a.
  2. **Monotonicity clamp je stisnil zadnjo postajo.** `const sMono = Math.max(s, lastS);` je zadnjo postajo (iste koordinate kot prva) prisilil na `sMono ≈ lastS` namesto na `totalM`. `scheduleS()` je zato zadnji segment trip-a zmrznil na napačnem s.
  3. **`findTripForLiveBus` ni razločeval prekrivajočih trip-ov.** Krožne linije imajo dva zaporedna trip-a, ki se prekrivata v 2-min buffer oknu. Headsign filter in nearest-stop heuristika nista razlikovala, zato se je lahko bus pripisal napačnemu trip-u.
  4. **`cropShape` je na loop-closure segmentu vrnil reverse čez celo pot.** Ker sta iFrom in iTo oba bila na duplicate-coord točkah (~začetek in ~konec), je `iFrom > iTo` sprožil `reverse()` → bus je v zadnjem segmentu izrisal nazaj skozi celo zanko.

  Popravki: `projectToPoly` ima zdaj neobvezen `preferNearS` parameter — pri skoraj-enako-oddaljenih projekcijah (znotraj 15 m) izbere tisto, ki je bližje prejšnjemu anchor-ju/progresu. V `setVehiclePaths` se `preferNearS = lastS` zagotovi, da zadnja postaja krožne linije pristane pri `s ≈ totalM`. V `snapshot()` `preferNearS = prevAnchor.s` prepreči teleport. `findTripForLiveBus` zdaj najprej filtrira strogo v-teku trip-e in šele kot fallback uporabi 2-min buffer. `cropShape` na zaprtih shape-ih (prva = zadnja točka) ne reverse-a, ampak naredi forward wrap `iFrom → konec + začetek → iTo`.

### Vpliv na druge linije
- **Linearne (1, 2, 6, 7...):** projectToPoly tiebreaker nima alternativ znotraj 15 m → obnašanje identično. Monotonicity clamp ostane. Closed-shape branch v cropShape false → identično.
- **V-teku filter:** Pozitivno tudi na linearnih — pri trip transition (prejšnji trip konča 12:00, novi začne 12:00) preprečuje flip-flop med overlapning trip-i. Če nobeden ni "v teku" (bus zamuja več kot 2 min), fallback na buffer ohrani staro vedenje.

---

## 0.6.1 — 2026-04-19

### Popravki
- **Pin mode je zdaj dvostopenjski, kot v Uber/Bolt.** v0.6.0 je križ stalno visel na sredini karte, kar je bilo moteče pri normalnem brskanju. Zdaj je skrit, dokler uporabnik ne tapne pin FAB-a (levo, MapPin ikona). Tap FAB → križ se pojavi, Načrtuj pill (desno) se spremeni v **"Potrdi tukaj"** (Check ikona), pin FAB pa v **"Prekliči"** (X). Drugi tap na Potrdi zabije pin na točno sredino karte in odpre planer. Prekliči ali izbira postaje/vozila pin mode avtomatsko zapustita.
- **Pin gre natanko na izbrano lokacijo, brez snap-a na najbližjo postajo.** v0.6.0 je `dropPinAtCenter()` najprej preveril, ali je pod križem postaja in v tem primeru raje izbral njo. To je bilo v nasprotju z uporabniškim namenom — če je želel postajo, bi jo tapnil direktno. Zdaj pin vedno emitira natančne lat/lon koordinate trenutnega centra karte → planer kot cilj uporabi točno to točko (reverse-geocode naknadno).

---

## 0.6.0 — 2026-04-19

### Novosti
- **Nov način izbire cilja na karti: "crosshair + FAB" vzorec (kot Uber/Bolt).** Long-press smo opustili po 3 neuspešnih iteracijah na iOS PWA (v0.5.1–v0.5.3) — MapLibre na iPhonu touch evente prestreza, zamuja ali preimenuje, kar je onemogočilo zanesljivo detekcijo 500 ms pritiska. Zamenjava: na sredini karte je zdaj ves čas viden rdeč pin + ground dot (natančna pixel pozicija), poleg rekapitulacijskega gumba pa **pin FAB** (levo spodaj, nad gumb "Moja lokacija"). Uporabnik premakne karto, da je križ točno kjer hoče, nato tapne FAB → cilj je postavljen. Če je pod križem postaja, raje izberemo njo. Deluje enako na iOS in Androidu, brez timerjev in gesture-race pogojev.
- **Imena postaj na karti (zoom 15+).** Vsaka postaja ima zdaj poleg rdeče pike tudi ime, izpisano v stilu CARTO Voyager/Dark Matter (Open Sans Regular), z belo/črno halo obrobo za berljivost. Font-size se interpolira od 10 px (zoom 15) do 13 px (zoom 19). Prepovedano prekrivanje (`text-allow-overlap: false`) + `text-optional: true` pomeni, da se pri gosto posejanih postajah nekatera imena skrijejo, namesto da bi se vsa napisna plast izgubila.

### Popravki
- **iPhone PWA "prazna lisa spodaj" ob prvem zagonu — odpravljena brez potrebe po rotaciji.** iOS je na prvi zagon PWA-ja v0.5.x vračal `100dvh` pred safe-area stabilizacijo, zato je aplikacija zgrešila home-indicator pas. Uporabniku je pomagalo šele landscape→portrait, ki je sprožil reflow. Fix: `main.ts` zdaj iz `visualViewport.height` / `window.innerHeight` postavi CSS var `--app-height`, jo uporabi kot primary vrednost v `html/body/#app` (fallback `100dvh`), in jo recomputa na `resize`, `orientationchange`, `visualViewport.resize` in `pageshow`. Double-rAF + dve timeout zadenejo tudi iOS-ov post-mount viewport settlement.

---

## 0.5.3 — 2026-04-19

### Popravki
- **Planer ne predlaga več poti, ki so počasnejše od direktne hoje.** Dodan walk-dominance filter: vsak transit plan mora prihraniti vsaj **2 min** vs. direktna hoja, sicer ga skrijemo. Primer nesmisla, ki je v0.5.2 še šel skozi: peš 8 min do postaje + bus 5 min (delno nazaj) + peš 2 min = 15 min, ko bi peš naravnost trajalo 12 min. Izjema: če je hoja daljša od 30 min (≥2.5 km), pustimo tudi marginalne bus predloge — uporabnik pogosto raje sede kot hodi predolgo.
- **Realnejši čas pešhoje — uporabljamo URBAN_DETOUR faktor (1.35×).** Prej je walk baseline uporabljal haversine zračno razdaljo, ki v mestu podceni resnično hojo (reka, križanja, enosmerne poti). Zdaj `sec = (metri × 1.35) / hitrost`, kar je skladno z istim faktorjem, ki je že v RAPTOR access/egress kot fallback. Posledica: walk baseline je realnejši in bus plani pošteno tekmujejo z njim.
- **Dolg pritisk na mapo na iPhonu — zdaj zanesljivo deluje.** v0.5.2 je samo odstranil `dragstart` listener, kar ni bilo dovolj — MapLibre na iOS občasno zamudi ali spremeni lastne touch evente zaradi gesture recognition-a (pan/pinch). Prepisano na **native DOM `touchstart`/`touchmove`/`touchend` listeneje** na map kontejnerju, ki jih MapLibre ne prestreže. Threshold 25 px, trajanje 500 ms. Pinch (2 prsta) pravilno prekine timer.

---

## 0.5.2 — 2026-04-19

### Popravki
- **Dolg pritisk na mapo (550 ms) zdaj zares deluje na iPhonu.** Prej je bil nameščen `map.on('dragstart', clearLP)` listener, ki je MapLibre sprožil že ob rahlem premiku prsta (pred 20 px threshold-om) in timer takoj ubil. Odstranjen; razlikovanje drag vs. long-press skrbi zdaj samo `touchmove` prag, ki je bil povišan iz 8 px na 20 px (tesnejši prag je na iOS lovil prstno "trzanje"). Multi-touch preverjamo tudi po razdalji med točkami — MapLibre včasih poroča 2 točki za en prst, kar je blokiralo veljaven long-press.
- **Planer ne predlaga več absurdnih poti "tja in nazaj" po isti liniji.** V RAPTOR inner loop dodana zapora: če smo do postaje prispeli z linijo R, vkrcanja nazaj na linijo R v naslednji rundi ne poskušamo več. Prejšnje: G2 do Pobrežja → G2 nazaj proti centru = nesmisel, ki je zmagal Pareto prag, ker je prihod teoretično minimalno boljši. Zdaj direktno obsoljeno.
- **Predlogi poti v planerju se vsi vidijo.** Modal površina je imela `overflow-hidden`, kar je odrezalo 3–4 predloge + oba vpisna polja + časovni izbirnik. Zamenjano za `overflow-y: auto` + `max-height: calc(100dvh - env(safe-area-inset-bottom))`. Dodan `-webkit-overflow-scrolling: touch` za nativen momentum scroll na iOS.
- **iOS PWA — prazna lisa pod vrstico zavihkov odstranjena.** Body background spremenjen iz `var(--bg)` (#F5F5F7 svetlo / #000 temno) v `var(--surface)` (#FFFFFF / #1C1C1E), tako da se zlije s TabBar-om v `env(safe-area-inset-bottom)` območju (home indicator). App bg zdaj živi eksplicitno na `#app` za notranje zaslone.

---

## 0.5.1 — 2026-04-19

### Popravki
- **Long-press na karti zdaj deluje na iOS Safari.** Prej je koda poslušala samo `mousedown`, ki ga Android Chrome sintetizira iz `touchstart`, iOS pa ga emuilira šele po `touchend` — 550 ms timer ni mogel steči. Dodan je `touchstart` + `touchmove` handler v MapLibre listenerje, z isto logiko kot mouse. Multi-touch (pinch) takoj prekliče long-press timer.
- **Callout meni na iOS ne prekinja več dolgega pritiska.** `-webkit-touch-callout: none` + `user-select: none` na map containerju in `.maplibregl-canvas` prepreči native iOS gesto za izbiro/kopiranje.

### Opomba za iPhone testerje
Za **full-screen PWA izkušnjo** (brez Safari toolbar-a) mora biti aplikacija dodana na začetni zaslon: Safari → Deli → "Dodaj na začetni zaslon" → odpri ikono. Meta `apple-mobile-web-app-capable` deluje samo v tem načinu; v Safari brskalniku toolbar ostane vidnj vedno (iOS omejitev).

---

## 0.5.0 — 2026-04-19

### Novosti
- **Gumb »Pot do postaje«** — v panelu izbrane postaje primaren (accent) gumb, ki takoj odpre planer z pred-izpolnjenim ciljem in `from = Moja lokacija`, nato **auto-run**. Iz 4+ tapov v 2-tap shortcut.
- **Dolg pritisk na mapo (≈550 ms) postavi cilj** — long-press na prazni točki propagira v planer kot destinacija; Nominatim reverse-geocode v ozadju zamenja `Izbrana lokacija (lat, lon)` z naslovom. `from` auto-filled + auto-run.
- **Tap na mapo zapre izbrano postajo** — prej samo X gumb; zdaj hitrejša navigacija med postajami.
- **Vrnitev na prejšnji pogled ob deselect postaje** — ob izbiri zapomni `{center, zoom}`, ob deselect flyTo nazaj. Ohranjeno pri preklopu med postajami (vedno vrne na izvirno stanje).
- **Pinch-zoom na mobilnih** — odstranjen `maximum-scale=1` iz viewport meta; end-user lahko povečuje zemljevid/UI.
- **Retry UI, če GTFS ne naloži** — namesto večne skeleton-ce uporabnik vidi polzaslonski overlay z gumbom "Poskusi ponovno".
- **Datum voznih redov v nastavitvah** — "Vozni redi: <datum>"; opozorilna barva, če so starejši od 30 dni (odhodi znani nadskritijo).

### Popravki
- **GTFS fetch retry deluje** — prej cache-an rejected Promise je blokiral vse naknadne poskuse; zdaj ob napaki počisti cache in dovoli nov poskus.

### Hitrost / interno
- **Planer indeksi precompute (WeakMap)** — Haversine O(n²) ≈ 206k izračunov za 454 postaj se naredi enkrat na GTFS objekt, ne ob vsakem klicu. `nearByStop` + `tripsByBoardStop` kešana po identiteti objekta.
- **Transfer penalty 180 s + Pareto prag 60 s** — prejšnji 120 s prag je včasih proglasil 2-linijske plane za "boljše", ker so prišli 90 s prej. Z penalizacijo prestopov in tesnejšim pragom prevladuje direktna povezava.
- **Service filter v RAPTOR inner loop** — preskoči trip-e nevaljavnih dnevov takoj, ne ob zbiranju rezultatov.
- **AbortController v planerju** — zapiranje modal-a / nov run prekine odprte `walkMatrix`/`walkRoute` fetche; stale rezultati se ne commit-ajo.
- **Auto-versioning SW** — `scripts/build-sw.mjs` generira `public/sw.js` iz template-a ob vsakem `predev`/`prebuild` z `VERSION = pkg.version-SHA`. Testerji dobijo sveže SW brez ročnega bumpanja; `public/sw.js` zdaj `.gitignore`-an.
- **`getCenter()` / `getZoom()` exposed v MapView** — za snapshot/restore logic.

### Varnost / infrastruktura
- **Nominatim User-Agent** bump na `MoHaMobil/0.5.0`.

---

## 0.4.0 — 2026-04-17

### Novosti
- **Velikost napisov na zemljevidu** — 3 stopnje (Manjši / Srednji / Večji) v Nastavitve → Karta.
- **Imena cest na satelitu** — CARTO Voyager symbol layers zmergeani prek Esri raster podlage, bel tekst s temnim obrisom za kontrast.
- **Napisi vidni prej** — `minzoom − 2` (min 2), da se imena ulic pojavijo pri nižjih zoom stopnjah.
- **Dostopnostni temi**:
  - **Visoki kontrast** (čisto bela podlaga, črn tekst, debele obrobe) — za slabovidne.
  - **Črno-belo / Monochrome** (grayscale `filter: grayscale(1)` na `#app`) — za uporabnike, ki ne razlikujejo barv.
  - Privzeta tema: **svetla** (prej auto).
- **Odhodi — izbira prikaza**: samo minute, samo ura, ali oboje (`DepartureDisplay` nastavitev + unified `DepartureTime.svelte` komponenta).
- **Kompakten seznam** — manjše višine vrstic, več vsebine na ekran (`compactLists` nastavitev).
- **Zvezdica ob izbrani postaji v LineTimetableModal** — hitro pripni kombinacijo `(postaja, linija, smer)` za dostop iz zavihka Priljubljeni.
- **Pripete linije vertikalno** — v priljubljenih postajah so chipi za pripete linije razporejeni navpično (namesto vodoravnega drsnega traku).

### Popravki
- Gumb »Omogoči lokacijo« — bela pisava na rdeči podlagi (prej črna, neberljiva).
- SW cache bump `v3 → v4` — osveži zastarele CARTO stile in GTFS po nadgradnji.

### Varnost / infrastruktura
- **Nominatim User-Agent** — dodan `MoHaMobil/0.4.0 (github.com/m1984m/MoHa-Mobil)` header; skladno z Nominatim usage policy, prepreči ban.

### Interno
- `MapView.extractLabelLayers()` — izlušči simbole iz Voyagerja, skipa POI/icon source-layers, skalira `text-size` z `['*', factor, val]` ekspresijo.
- `styleKey(dark, kind, lsize)` — trojni ključ, sproži `setStyle()` reload ob spremembi velikosti napisov.
- Nov `favLines.ts` store (`mm.favLines.v1`) za pripete `(stopId, routeId, dir)` kombinacije.
- `theme.ts` razširjen iz 3 → 5 tem, `THEME_CLASSES` array prepreči class leakage ob preklopu.

---

## 0.3.0 — april 2026

### Novosti
- Natančnejše animacije avtobusov (GTFS schedule + OBA GPS anchor hibrid) in pešpoti.
- Priljubljene postaje: swipe za izbris, pripete linije.
- Več nastavitev za osebno prilagoditev.

### Interno
- Hibridna interpolacija vozil: bus napreduje po voznem redu, OBA GPS služi kot anchor za offset.
- ORS (OpenRouteService) foot-walking matrix za pre-fetch realnih časov hoje v planerju.
- `startPolling()` — setInterval poll (8s) + `requestAnimationFrame` loop za smooth prikaz.

---

## 0.2.0 — marec 2026 (prvi javni deploy)

### Funkcionalnost
- Prva javna objava na GitHub Pages: https://m1984m.github.io/MoHa-Mobil/
- Zavihki: Dom, Vozni redi, Karta, Priljubljeni, Nastavitve.
- MapLibre GL vector/raster render; CARTO Voyager (light) in Dark Matter (dark) podlage.
- GTFS Marprom (stops/routes/trips/service) + OBA live prihodi.
- Planer poti (RAPTOR algoritem) z OSRM/ORS pešpotmi.
- PWA — manifest, service worker, offline cache (GTFS + tiles).
- Shranjene poti, priljubljene postaje.
- Vremenski modal (Open-Meteo).

### Popravki pred deploy-em
- `crypto.randomUUID()` fallback za starejše mobile brskalnike.
- Nested `<button>` napaka v priljubljenih (accessibility).
- Double-tap zoom privzeto onemogočen (prepreči zoom ob tap-ih).
- Deploy skript `npm run deploy` (GitHub Pages `gh-pages` branch).

---

## Referenca

- **Slog različic**: 0.x.y — `MAJOR` ostane 0 do stabilne prve izdaje; `MINOR` za nove funkcionalnosti; `PATCH` za popravke.
- **Format tega dokumenta**: ohranjaj obratno kronološki vrstni red, vsaka različica ima ISO datum + sekcije `Novosti / Popravki / Varnost / Interno` (uporabi samo tiste, ki so relevantne).
- **UI Novosti sekcija** (`SettingsScreen.svelte → Novosti`): prikaže le **zadnjo različico**, **največ 4 bullete**. Zgodovina živi tukaj.
