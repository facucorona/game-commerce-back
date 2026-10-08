# GamE-Commerc · API

Backend Express + Postgres (Sequelize). Sirve el catálogo, auth JWT, carrito/órdenes, pagos y el sincronizador propio de Steam (reemplaza a RAWG).

## Stack

Express · Sequelize + Postgres · Passport JWT · MercadoPago SDK (`payment`) · axios (Steam).

## Arranque

```powershell
node index.js   # puerto 3001, Postgres en 5432
```

Base local: `videogames` (usuario/clave `postgres/postgres`, ver `DB_*` abajo).

## Variables de entorno (`.env`)

| Var | Ejemplo | Para qué |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_NAME` | `postgres/postgres/localhost/videogames` | Conexión Sequelize |
| `DB_SEED` | `steam` | Siembra inicial: `steam` (catálogo desde Steam) o `none` (tabla vacía) |
| `KEY_SECRET` | (secreto largo) | Firma del JWT |
| `URL_ALLOWED` | `http://localhost:3000` | Links de restore/checkout hacia el front |
| `URL` | `http://localhost:3001/` | Base pública del API (links PayPal) |
| `ACCESS_TOKEN` | (token MP) | Opcional: sin él, `/payment` responde **503** (checkout desactivado, no tira el server) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Opcional: sin ellas, login con Google desactivado |
| `STEAM_*` | ver tabla abajo | Sincronizador de Steam |

## Auth

- El JWT se lee **solo de la query**: `?tkn=<token>` (`ExtractJWT.fromUrlQueryParameter('tkn')`, estrategia `'jwt'`).
- Guard global en `src/app.js`: todo exige token **salvo** `PUBLIC_ROUTES` (`/videogames`, `/genres`, `/platforms`, `/reviews`, `/login`, `/logout`, `/signin`, `/restore`, `/user/find`) **y** bypass de `OPTIONS` (preflight CORS).
- `src/index.js` del front agrega el `?tkn=` automáticamente vía interceptor.

## Endpoints

| Ruta | Auth | Qué hace |
|---|---|---|
| `/videogames?name=` | pública | Catálogo / búsqueda en BD local |
| `/genres`, `/platforms` (+ `/used`) | pública | Filtros y los que realmente se usan |
| `/reviews` | pública | Reseñas |
| `/login`, `/logout`, `/signin`, `/restore` | pública | Auth y recupero |
| `/user`, `/users`, `/user/editprofile` | JWT | Perfil, favoritos, admin de usuarios |
| `/cart`, `/order`, `/payment` | JWT | Carrito, órdenes, checkout MP (503 sin token) |
| `/paypal` | JWT | Alternativa PayPal |
| `/steam-sync` | JWT + admin | Sincronizador Steam (abajo) |

## Sincronizador Steam (`src/services/steam/`)

Importador propio: Steam es la única fuente del catálogo (precio y descuento reales por región, sin API key ni 2FA).

| Archivo | Rol |
|---|---|
| `client.js` | HTTP vs Steam: 1 request cada 600 ms + jitter, reintentos 429/5xx con backoff, pausa global si Steam devuelve HTML 200 ("Site Error") en vez de JSON. Endpoints: `appdetails` (detalle), `search/results` (relevamiento), `featuredcategories` (ofertas), SteamSpy (respaldo de appids) |
| `mapper.js` | Traduce payload Steam → modelos (`Products`, `Screenshots`, géneros/plataformas). `price` (tu venta) **nunca** se pisa: Steam va a `steam_price_*`; solo en el ALTA se propone como punto de partida |
| `syncService.js` | `syncCatalogo` (upsert por `steam_appid`, nunca duplica), `syncOfertas` (precio/descuento), `reEtiquetarPorNombre` (match exacto por slug para juegos heredados), `estado()`. Deja fila en `SyncRun` por corrida |
| `scheduler.js` | Tablero con `setTimeout` encadenado (no cron): ofertas 12h, catálogo 1d, full semanal. Solo con `STEAM_SYNC_ENABLED=true` |

Rutas admin: `GET /steam-sync` (estado), `POST /steam-sync/catalog`, `POST /steam-sync/offers`, `POST /steam-sync/retag`.

Detalle largo del "scrap": `./SYNC_STEAM.md`. Contexto de producto: `./PRODUCT.md`.

### Env del sync

| Var | Defecto | Para qué |
|---|---|---|
| `STEAM_SYNC_ENABLED` | apagado | `true` para encender el scheduler |
| `STEAM_CC` / `STEAM_LANG` | `ar` / `english` | Región del precio e idioma |
| `STEAM_MIN_INTERVAL_MS` | `600` | Ritmo entre requests (bajarlo = bloqueo) |
| `STEAM_RATE_LIMIT_PAUSE_MS` | `45000` | Pausa global ante HTML de Steam |
| `STEAM_OFFERS_EVERY` / `STEAM_CATALOG_EVERY` / `STEAM_FULL_EVERY` | `12h` / `1d` / `1w` | Frecuencias (`12h`, `1d`, `1w`, `30m`…) |
| `STEAM_CATALOG_LIMIT` / `STEAM_MAX_SCREENSHOTS` | `200` / `5` | Tamaño de corrida y capturas por juego |
| `STEAM_LOCK_TTL_MIN` | `15` | TTL del lock `running` en `SyncRuns` (instancias muertas) |
| `SYNC_CATALOG_HOURS` / `SYNC_OFFERS_HOURS` | `24` / `6` | Ventanas del trigger por visita |
| `SYNC_TOP_CATALOG` / `SYNC_TOP_OFFERS` | `6` / `12` | Juegos por visita (entran en el timeout serverless) |
| `STEAM_APPIDS` | — | Lista manual fija (bypasea relevamiento) |
| `STEAM_DISCOVERY` | — | `none` desactiva SteamSpy |
| `STEAM_PRECIO_EQUIVALENCIA` | activo | `false` = en altas no propone precio Steam |
| `STEAM_APPID_CACHE` | `appids-cache.json` | Caché local de appids relevados |

## Deploy en Vercel (serverless)

El backend es un servidor Express clásico, pero funciona en Vercel con tres adaptaciones (ya hechas):

1. **Handler**: `api/index.js` exporta la app (`src/app.js` ya hace `module.exports = server`) y `vercel.json` rewritea todo ahí. `index.js` (con `listen()`) no corre en serverless.
2. **Trigger por visita en vez de scheduler**: `GET /videogames` dispara `syncAlEntrar()` sin esperar. Catálogo viejo de +24 h → refresca los 6 más antiguos; ofertas viejas de +6 h → refresca 12. El lock vive en `SyncRuns` (no en memoria) con TTL de 15 min. `STEAM_SYNC_ENABLED` queda en `false`.
3. **Bootstrap manual de la DB**: `conn.sync()`, migraciones y semilla no corren solos. Una vez contra la DB de producción: `npm run db:migrate` (idempotente, se repite sin riesgo).

Env de producción en Vercel: `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` (Neon), `KEY_SECRET` y `SECRET_KEY` nuevos, `URL_ALLOWED` = URL del front, `URL` = URL del API con barra final, `NODE_ENV=production`, `STEAM_SYNC_ENABLED=false`. El caché de appids va a `/tmp` solo (filesystem de solo lectura).

## Estructura

```
src/
  app.js          # guard JWT + PUBLIC_ROUTES + bypass OPTIONS
  db.js           # Sequelize, modelos, seed inicial
  routes/index.js # mapa de rutas
  controllers/    # uno por recurso (+ conSteamSync, loginUser, payment…)
  services/steam/ # sincronizador (arriba)
api/index.js      # handler serverless (Vercel)
scripts/migrate.js# bootstrap de DB: sync + migraciones + semilla
vercel.json       # rewrite todo → /api
```
