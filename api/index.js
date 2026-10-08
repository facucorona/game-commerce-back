/**
 * Handler serverless para Vercel.
 * ----------------------------------------------------------------------------
 * Vercel no ejecuta `index.js` (no hay `listen()` en serverless): cada archivo
 * en `/api` es una función que recibe requests. Acá se exporta la app Express
 * ya armada (`src/app.js` exporta el server), y `vercel.json` rewritea todo a
 * esta función.
 *
 * Lo que NO corre acá (y dónde hacerlo):
 *   - `conn.sync()` + migraciones + semilla → `npm run db:migrate`, UNA vez
 *     contra la DB de producción (y cada vez que cambie el modelo).
 *   - scheduler de Steam → reemplazado por el trigger por visita
 *     (`syncAlEntrar` en GET /videogames). STEAM_SYNC_ENABLED queda en false.
 */
module.exports = require('../src/app.js');
