/**
 * Bootstrap de la DB para serverless (Vercel).
 * ----------------------------------------------------------------------------
 * En Vercel `index.js` nunca se ejecuta (no hay `listen()`), así que `conn.sync()`,
 * las migraciones y la semilla inicial no corren solas. Este script hace ese
 * trabajo UNA vez contra la DB de producción:
 *
 *   1. conn.sync() → crea las tablas que falten
 *   2. migraciones 001 (columnas Steam) y 002 (columnas de rating)
 *   3. semilla → si Products está vacía, importa el catálogo inicial de Steam
 *      (tarda varios minutos: ~200 juegos a ~600 ms + rating; es normal)
 *
 * Uso (con el .env de producción cargado):
 *   npm run db:migrate
 *
 * Se vuelve a correr solo si cambia el modelo o las migraciones. Las
 * migraciones son idempotentes (IF NOT EXISTS), así que repetirlo es seguro.
 */
const { conn, semillaSiEstaVacia } = require('../src/db.js');
const m001 = require('../src/migrations/001_steam_sync');
const m002 = require('../src/migrations/002_steam_rating');

(async () => {
  await conn.sync({ force: false });
  console.log('[migrate] tablas ok');
  await m001.run(conn);
  await m002.run(conn);
  await semillaSiEstaVacia();
  console.log('[migrate] listo');
  process.exit(0);
})().catch((err) => {
  console.error('[migrate] falló:', err.message);
  process.exit(1);
});
