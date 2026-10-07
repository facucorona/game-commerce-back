# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: LatAm PC gamers (AR-focused) browsing and buying videogames. Job: discover games in catalog (/home), inspect detail (/detail/:id), manage cart (/shopping_cart), check out, and revisit library (/my_store), wishlist (/wish_list), reviews, and profile (/userprofile).

Secondary: store admins. Job: manage catalog (create game, Steam sync), orders/sales, users via /admin panel with tabs, metrics, and record tables. Admin routes are gated on `users.user.isAdmin`.

## Product Purpose

Functional e-commerce demo / portfolio project for selling videogames online. Success means: catalog browses, detail-to-cart-to-checkout completes, orders land in the library, and admins can keep catalog/prices/offers current. No production marketplace scale or SLA claim.

## Positioning

No market-differentiation claim against Steam. Per confirmed answer, this is a course/portfolio build, not a Steam competitor. Steam is a data source (catalog, offers, screenshots via public API, no key), not the storefront rival. The store's own `price` (sale price) is separate from Steam `steam_price_*` reference values.

## Operating Context

Core shopper workflow: `/` landing → `/home` catalog grid → `/detail/:id` (reads game from redux loaded by /home; direct URL/F5 stays on "CARGANDO...") → `/shopping_cart` → checkout (`/payment` via MercadoPago) → `/success` → library (`/my_store`).

Auth: `/login`, `/create_user`, `/restore`, `/changepass/:id/:token`, `/verify/:email`, Google OAuth (`/auth/google`, `/oauth2/:token`) disabled without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. JWT is read only from query `?tkn=`; client axios interceptor appends it. API bypasses JWT for `OPTIONS` preflight and `PUBLIC_ROUTES` (`/videogames`, `/reviews`, `/user/find`).

Admin/sync workflow (admin-only, `?tkn=` + `isAdmin` re-checked against Users): `GET /steam-sync` status, `POST /steam-sync/catalog` (limit/appids/wait), `POST /steam-sync/offers`, `POST /steam-sync/retag`. Optional scheduler chain (`STEAM_SYNC_ENABLED`, offers ~12h / catalog daily / full weekly; off in dev). Backups under `backups/` via pg_dump/pg_restore.

Dev entry: front `npm start` (with `NODE_OPTIONS=--openssl-legacy-provider` on current Node) + `npm run build-css` / `watch-css` (CRA4 ignores postcss config, Tailwind CLI compiles `src/index.css` → `public/styles.css`); API `node index.js`.

## Capabilities and Constraints

Confirmed functionality: game catalog with filters/search/pagination, detail with gallery + reviews, cart, wishlist, user accounts/profiles, order history, admin CRUD + sales/users/orders views, reviews, MercadoPago checkout, Steam catalog/offers/retag sync with `SyncRun` log.

Technical constraints: React 17 + CRA4/webpack4 + react-router 5 + redux/thunk; Express + Sequelize/Postgres; Tailwind 3 via CLI. Zero new dependencies (ESM-only libs do not compile). App logic is untouchable during visual work: handlers, redux `dispatch`, `Swal.fire`, axios calls, routes/`Link`, button `name=`/`value=` read via `e.target`. `/payment` returns 503 without MercadoPago `ACCESS_TOKEN`. Steam `appdetails` accepts one appid per request; rate-limit appears as HTTP 200 HTML "Site Error" → client freezes 45s, base pace ~600ms + jitter. `price` is never overwritten by sync except on creation (`STEAM_PRECIO_EQUIVALENCIA`); 47/89 sampled games have no Steam AR price reference and need manual pricing.

Undecided: supported regions/currency beyond ARS reference, production deploy target, real payment credentials.

## Brand Commitments

Name: GamE-Commerc. Incumbent identity: arcade / "sala de recreativas" per `DESIGN_SYSTEM.md` (cabinet/card metaphor, marquee bulbs, scanlines, `INSERT COIN` / `GAME OVER` language). Icons: bootstrap-icons only (`<i className="bi ...">`); never emojis. Binding rule from repo: `className=` always (React ignores `class=`); `credit` color reserved for prices.

## Evidence on Hand

Real sources at repo root and subfolders: `DESIGN_SYSTEM.md` (tokens, patterns, toolchain, screen map); `SYNC_STEAM.md` (Steam endpoints, schema, env vars, file map); `e-commerce_client-main/e-commerce_client-main/src/` (routes in `src/App.js`, ~30 component folders); `e-commerce_API-main/e-commerce_API-main/src/` (controllers, models, routes, steam services, migrations); `backups/` DB dumps. No real testimonials, customers, benchmarks, or production pricing to cite — future work must not fabricate them.

## Product Principles

1. Storefront truth over source truth: own price, cart, and orders win; Steam data stays reference.
2. Demo must stay runnable locally without keys: missing MercadoPago/Google/RAWG/IGDB degrades to disabled, never to a crash.
3. Admin tooling is part of the product: every catalog/offers change must be doable and auditable (SyncRun) by an admin.
4. Logic preservation first: visual or sync work never rewrites purchase, auth, or checkout behavior.
