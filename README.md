# Voortgang Thijs

Apart teamdashboard met een actuele klantenlijst, filters, een prioriteitentabel en uitklapbare historie. De afgeschermde beheeromgeving op `/beheer` is de standaardinvoer. Iedere publicatie legt een apart rapportagemoment vast. Gepubliceerde momenten kunnen achteraf bewust als correctie worden aangepast. Het project heeft geen koppeling met een ander dashboard.

## Dagelijks gebruik

1. Open `/beheer` en log in met het aparte beheerderswachtwoord.
2. De klanten en laatst ingevulde gegevens staan al klaar. Werk prioriteit, status, acties, deadline en aandachtspunt bij. Datum en weeknummer worden automatisch bepaald.
3. Kies op dinsdag en donderdag **Update publiceren**.
4. Deel dezelfde dashboardlink. Collega’s kunnen de rapportagemomenten vergelijken en per klant eerdere acties uitklappen.

De collegaweergave is alleen-lezen en bevat geen link naar beheer. De invoer verandert daar pas nadat een update is gepubliceerd. Een lokaal concept blijft in de browser bewaard. Iedere publicatie bevat alle klanten. Een klant afronden doe je met de status Afgerond; klantnamen niet wijzigen of verwijderen zonder een gecontroleerde migratie. Een naam bepaalt momenteel de vaste klant-ID. Dubbele rangnummers mogen voorkomen.

## Optioneel: Google Sheets koppeling

De beheeromgeving maakt Google Sheets niet meer noodzakelijk. Wie de bestaande Sheet toch als alternatieve invoer wil gebruiken, kan de koppeling eenmalig installeren. Het toevoegen van de broncode in GitHub activeert deze koppeling niet.

1. Open het oorspronkelijke Sheet en kies **Extensies → Apps Script**.
2. Voeg een nieuw scriptbestand toe en plak de inhoud van `integration/Voortgang.gs`. Laat bestaande scripts staan.
3. Voeg bij Projectinstellingen → Script properties `DASHBOARD_URL` en `SYNC_TOKEN` toe. Gebruik de URL van de nieuwe Railway service en de bijbehorende geheime syncsleutel. Deel die sleutel niet met dashboardlezers.
4. Voer `voortgangMenu` uit. Geef Google toestemming wanneer daarom wordt gevraagd.
5. Kies in je Sheet **Voortgang dashboard → Invoer eenmalig klaarzetten**. Dit maakt een nieuw tabblad; de drie bestaande tabbladen worden niet gewijzigd.
6. Controleer de overgenomen gegevens. Vervolgens publiceer je de eerste update via hetzelfde menu.
7. Voor een automatisch menu bij openen: voeg `voortgangMenu();` toe aan een bestaande `onOpen` functie. Bestaat die niet, voeg dan `function onOpen() { voortgangMenu(); }` toe.

De kolom Week laatste klantupdate is broninformatie die je bijwerkt wanneer je een klant bijwerkt. De exacte publicatiedatum wordt altijd door de server vastgelegd. Er zijn geen automatische dinsdag/donderdag triggers ingesteld: de knop legt de door jou gecontroleerde stand vast.

## Bestaande historie

Het oorspronkelijke bestand bevat weken, maar geen betrouwbare verzenddatums of historische prioriteitsrangnummers. De import bewaart die weken zonder een exacte datum of rangnummer te verzinnen. De huidige rangnummers vormen een apart startpunt. Aanhalingstekens die 'zelfde als vorige rij' betekenen zijn uitgeschreven binnen dezelfde klant. Lege deadlines worden niet automatisch meegenomen uit eerdere weken.

## Lokale start

Benodigd: Node.js 24. Er zijn geen externe Node dependencies.

```sh
npm test
DEMO_MODE=true npm start
```

Open `http://127.0.0.1:8080`. Deze expliciete voorbeeldmodus luistert alleen lokaal en is in productie geblokkeerd. Als `data-private/initial-data.json` aanwezig is, importeert de lokale server dat bestand eenmalig in `.data/voortgang.sqlite`. Zonder dit bestand start de website met een lege database.

## Railway

Gebruik een nieuw project en deze repository. De Dockerfile start de applicatie. Koppel een Railway Volume op `/data`, gebruik één replica en de healthcheck `/health`. De applicatie weigert in productie te starten zonder de door Railway geleverde volumevariabele. Het volume bewaart de SQLite database over deployments heen.

Maak toegangssleutels met `node scripts/create-secrets.mjs`. Stel `TEAM_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` en `SYNC_TOKEN` als Railway variabelen in. Gebruik de leesbare wachtwoorden alleen om toegang te delen; plaats ze niet in GitHub. Cookies verlopen na 12 uur. Een wijziging van SESSION_SECRET logt alle gebruikers uit.

Voor een eenmalige historische import kan `INITIAL_DATA_GZIP_BASE64` het gecomprimeerde private JSON-bestand bevatten. Dit wordt uitsluitend ingelezen bij een lege database. De server biedt ook `/api/import` voor een lege database en `/api/snapshots` voor nieuwe rapportagemomenten, beide met `Authorization: Bearer <SYNC_TOKEN>`. De sleutel geeft schrijftoegang.

De klantdata, Excelbron, database en sleutels staan nooit in Git. Een private lokale kopie of projectdownload mag `data-private` bevatten: behandel die map als vertrouwelijk en voeg hem niet met `git add -f` toe. Configureer voor langdurig gebruik ook Railway volume-backups.

## Bronnen

Google Apps Script gebruikt [custom menus](https://developers.google.com/apps-script/guides/menus) en [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app). De database gebruikt [Railway Volumes](https://docs.railway.com/volumes).
