const server = require('./src/app.js');
const { conn, semillaSiEstaVacia } = require('./src/db.js');
// Migración 001: agrega las columnas de Steam a las tablas que ya existían
// (sequelize.sync() crea tablas, pero no agrega columnas).
const migrarSteam = require('./src/migrations/001_steam_sync');
// Migración 002: columnas del rating oficial de Steam (score 0-10 + veredicto).
const migrarRating = require('./src/migrations/002_steam_rating');
// Tablero de sincronización (ofertas 12h · catálogo diario · full semanal).
// Sólo se prende si STEAM_SYNC_ENABLED=true.
const steamScheduler = require('./src/services/steam/scheduler');

/*
 * ORDEN DE ARRANQUE (importa, y por eso quedó encadenado con .then):
 *   1. conn.sync()  → crea las tablas que falten (products, sync_runs, etc.)
 *   2. migración    → agrega a Products/Screenshots las columnas nuevas
 *   3. listen()     → recién acá el API responde
 *   4. semilla      → si la tabla está vacía, importa el catálogo
 *   5. scheduler    → arranca el tablero de sincronización (si está habilitado)
 *
 * Antes, la semilla (que vivía dentro de db.js con un setTimeout de 2 s) podía
 * ejecutarse antes que el sync y tiraba el proceso. Ahora espera su turno.
 */
conn
  .sync({ force: false })
  .then(() => migrarSteam.run(conn))
  .then(() => migrarRating.run(conn))
  .then(() => {
    server.listen(process.env.PORT, () => {
      console.log('%s listening at ' + process.env.PORT); // eslint-disable-line no-console
      steamScheduler.start();

      // La semilla va con delay para no competir con el arranque por el pool de
      // conexiones: importa ~200 juegos a ~600 ms cada uno.
      setTimeout(() => {
        semillaSiEstaVacia().catch((err) => console.error('[db] falló la semilla:', err.message));
      }, 5000);
    });
  })
  .catch((err) => {
    console.error('[db] no se pudo arrancar el API:', err.message);
    process.exit(1);
  });