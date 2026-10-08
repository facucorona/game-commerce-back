# Sincronizador de Steam

Cómo entra el catálogo, las ofertas y las capturas. Todo local, sin API keys.

---

## 1. Por qué Steam y no RAWG ni IGDB

| Fuente | Estado real (2026) |
|---|---|
| **RAWG** | Pide `API_KEY` y sin ella responde 401. La clave del `.env` está vacía y no hay forma de sacarse una cuenta desde acá. **Descartada.** |
| **IGDB (Twitch)** | El alta dedeveloper exige 2FA de Twitch y el SMS nunca llega. **Descartada.** |
| **Steam** | API pública, sin key, sin cuenta, con precio y descuento **reales por región**. **Elegida.** |

Steam no es un metadata-only: es el lugar donde el juego se vende, así que la
precio que trae es la que necesita una tienda.

---

## 2. Endpoints que se usan

| Uso | Endpoint | Notas |
|---|---|---|
| Detalle de 1 juego | `/api/appdetails?appids=<id>&cc=<cc>` | **Acepta un solo appid por pedido** (con varios da 400). Es el más estable de todos. |
| Buscar juegos | `/search/results/?…&infinite=1&json=1` | Devuelve `results_html`. Los appid se sacan con `data-ds-appid="…"`, los títulos de `<span class="title">`. |
| Destacados | `/api/featuredcategories/?cc=<cc>` | specials, top_sellers, new_releases, coming_soon. |
| Respaldo de ids | `steamspy.com/api.php?request=all&page=N` | 1000 ids por página. Sólo aporta **ids**; los datos salen siempre de `appdetails`. |

### El rate limit de Steam no se avisa

Si te pasás, Steam **no** devuelve 429: contesta **200 con una página HTML
titulada “Site Error”** en lugar del JSON. Por eso `client.js`:

- valida que la respuesta sea un objeto (si es texto, es bloqueo),
- lo trata como error reintentable,
- y **congela todos los requests 45 s** (`STEAM_RATE_LIMIT_PAUSE_MS`) para no
  seguir insistiendo y empeorar el bloqueo.

Ritmo por defecto: 1 request cada 600 ms + hasta 250 ms de azar. Con 200 juegos
son ~2 minutos. Bajar ese número es la forma más rápida de que te bloqueen.

---

## 3. Qué guarda (y qué no toca)

**Nunca toca** usuarios, carritos, órdenes, reseñas. **Nunca pisa `price`**
(es tu margen), salvo en el **alta** de un juego nuevo.

### Columnas nuevas en `Products`

| Campo | Para qué |
|---|---|
| `steam_appid` | Clave externa, con índice único. Es lo que hace el `upsert`. |
| `steam_price_currency` / `steam_price_original` / `steam_price_final` | Precio de **referencia** de Steam. |
| `steam_discount_percent` / `steam_price_expires` | Descuento y vencimiento. |
| `developers` / `publishers` | Los trae el detalle de Steam. |
| `isFree` | OJO: significa “Steam no lo vende acá”, no “es free-to-play”. |
| `source` | `steam` \| `rawg` \| `manual`. |
| `last_synced_at` | Última pasada del sync sobre esa fila. |

En `Screenshots`: `position` (orden) y `hash` (para detectar si la imagen cambió).

Tabla nueva: **`SyncRun`** — una fila por corrida con qué se creó, actualizó,
omitió y falló.

### Dos monedas distintas, no las confundas

- `price` → **tu** precio de venta. Sólo se escribe al crear el juego, con el
  precio de Steam como punto de partida (`STEAM_PRECIO_EQUIVALENCIA`).
- `steam_price_*` → lo que dice Steam, sólo referencia.

Steam hoy **responde en USD para `cc=ar`** (Argentina ya no tiene precios en pesos
en Steam; `cc=es` da EUR, `cc=mx` da MXN). Por eso los precios propuestos están
en dólares.

### 47 de 89 juegos no tienen precio de referencia

Comprobado con Steam: War Thunder, Crossout, Destiny 2, Lost Ark y otros llegan
con `price_overview: null` porque **en Argentina no se venden en la tienda de
Steam** (van por launcher propio o Epic). Esos juegos hay que ponerles precio a
mano en el panel; no es un bug del sincronizador.

---

## 4. Endpoints (solo admins)

Requieren JWT (`?tkn=`) **y** `isAdmin`. El token sólo trae `{id, email}`, así que
el controlador vuelve a consultar `Users`: es la única fuente válida y respeta
un cambio de permisos sin esperar a que expire el token.

```powershell
# Estado: corridas, cuántos juegos hay, cuántos sin género, caché
curl "http://localhost:3001/steam-sync?tkn=MI_TOKEN"

# Catálogo (hasta 200 por defecto). Sin `wait` devuelve 202 y sigue en segundo plano.
curl -X POST "http://localhost:3001/steam-sync/catalog?tkn=MI_TOKEN" `
  -H "Content-Type: application/json" -d "{\"limit\":50,\"wait\":true}"

# Recargar juegos puntuales por appid
curl -X POST "http://localhost:3001/steam-sync/catalog?tkn=MI_TOKEN" `
  -H "Content-Type: application/json" -d "{\"appids\":\"730,440,570\",\"wait\":true}"

# Ofertas: refresca precio y descuento de lo ya importado
curl -X POST "http://localhost:3001/steam-sync/offers?tkn=MI_TOKEN" -d "{\"wait\":true}"

# Re-etiquetar por nombre (géneros y plataformas de juegos que vienen de otra fuente)
curl -X POST "http://localhost:3001/steam-sync/retag?tkn=MI_TOKEN" `
  -H "Content-Type: application/json" -d "{\"limit\":50,\"wait\":true}"
```

---

## 5. El tablero automático

`STEAM_SYNC_ENABLED=true` prende tres trabajos (sin `node-cron`: es una cadena
de `setTimeout`, que además no acumula tareas ni deriva):

| Trabajo | Frecuencia por defecto | Qué hace |
|---|---|---|
| ofertas | cada 12 h | Precio, descuento y vencimiento. |
| catálogo | 1 vez por día | Entra lo nuevo. |
| full | 1 vez por semana | Recorre todo. |

Los releventos **quedan apagados en desarrollo**: si no los prendés, cada 12 h le
estás pidiendo 200 juegos a Steam sin querer.

### Trigger por visita (reemplazo serverless del tablero)

En Vercel no hay proceso vivo: `index.js` no corre, así que el tablero de arriba
no existe. En su lugar, `GET /videogames` (carga de la home) dispara
`syncAlEntrar()` **sin esperar la respuesta**:

- Mira la última corrida `ok` de cada tipo en `SyncRuns`.
- Catálogo viejo de +24 h → refresca los 6 juegos más antiguos (`last_synced_at`).
- Ofertas viejas de +6 h → refresca precio/descuento/rating de los 12 más antiguos.
- El lock vive en la base (`status: 'running'` con TTL de 15 min), no en memoria:
  dos visitas simultáneas no duplican el trabajo. Si una instancia muere a mitad
  del sync, el lock expira y la próxima visita reintenta.

Topes chicos a propósito: 12 ofertas × 2 requests × 600 ms ≈ 15 s, dentro del
timeout serverless. Con el uso, el catálogo entero se va refrescando solo.

---

## 6. Variables de entorno

Todas están en `.env`, comentadas. Las que importan:

| Variable | Default | Qué hace |
|---|---|---|
| `DB_SEED` | `steam` (si no hay `API_KEY`) | Con qué se llena la tabla cuando está vacía: `steam` \| `rawg` \| `none`. |
| `STEAM_SYNC_ENABLED` | `false` | Prende el tablero. |
| `STEAM_CC` / `STEAM_LANG` | `ar` / `english` | Región del precio e idioma. |
| `STEAM_MIN_INTERVAL_MS` | `600` | Ritmo entre requests. |
| `STEAM_RATE_LIMIT_PAUSE_MS` | `45000` | Cuánto se congela al detectar el bloqueo. |
| `STEAM_DISCOVERY` | `both` | Fuentes de ids: `both` \| `none`. |
| `STEAM_APPIDS` | vacío | Lista fija de appids (tiene prioridad sobre el relevamiento). |
| `STEAM_CATALOG_LIMIT` | `200` | Cuántos juegos trae el relevamiento. |
| `STEAM_MAX_SCREENSHOTS` | `5` | Capturas por juego. |
| `STEAM_PRECIO_EQUIVALENCIA` | `true` | Si el alta propone el precio de Steam o deja 0. |
| `STEAM_DEBUG_STACK` | — | `true` imprime el stack completo de cada error del sync. |
| `STEAM_LOCK_TTL_MIN` | `15` | Cuánto dura el lock `running` antes de considerarse huérfano (instancia muerta). |
| `SYNC_CATALOG_HOURS` / `SYNC_OFFERS_HOURS` | `24` / `6` | Ventanas del trigger por visita en `GET /videogames`. |
| `SYNC_TOP_CATALOG` / `SYNC_TOP_OFFERS` | `6` / `12` | Cuántos juegos refresca cada visita. |
| `STEAM_APPID_CACHE` | local / `/tmp` en Vercel | Caché de appids (en Vercel va a `/tmp`, se pierde entre invocaciones). |

---

## 7. Archivos

```
src/services/steam/client.js        requests, rate limit, detección de bloqueo
src/services/steam/mapper.js        Steam → campos de Products/Screenshots
src/services/steam/syncService.js   upsert por steam_appid, catálogo, ofertas, retag
src/services/steam/scheduler.js     tablero con setTimeout (sin dependencias)
src/services/steam/appids-cache.json  caché local de ids relevados
src/controllers/conSteamSync.js     endpoints admin
src/models/SyncRun.js               bitácora de corridas (también es el lock distribuido)
src/migrations/001_steam_sync.js    columnas nuevas (idempotente, corre en cada boot)
src/migrations/002_steam_rating.js  columnas del rating oficial (score 0-10 + veredicto)
api/index.js                        handler serverless para Vercel (exporta la app Express)
scripts/migrate.js                  bootstrap de DB para serverless (`npm run db:migrate`, una vez)
```

La migración corre sola en cada arranque: `conn.sync()` crea tablas pero **no
agrega columnas** a las que ya existen, que fue el error que Tiró el primer
arranque. `sync({alter: true})` se descartó a propósito porque rehace la tabla
completa en cada boot.

---

## 8. Respaldo de la base

```powershell
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U postgres -d videogames -F custom -f backups\videogames-$(Get-Date -Format "yyyyMMdd-HHmmss").dump
```

Hay respaldos en `backups/`. Restaurar:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U postgres -d videogames --clean --if-exists backups\videogames-AAAAMMDD-HHMMSS.dump
```

⚠️ **Las tablas puente se crean con `ON DELETE CASCADE`**: si borrás un género o
una plataforma, desaparecen también las filas de `ProductGenre` y `PlatformGame`,
y el juego queda sin filtros. Para eso está `POST /steam-sync/retag`.