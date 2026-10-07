/**
 * MIGRACIÓN 001 — columnas del sincronizador de Steam
 * ----------------------------------------------------------------------------
 * Por qué hace falta un archivo como éste:
 *   `conn.sync({ force: false })` (index.js) CREA las tablas que faltan, pero NO
 *   le agrega columnas nuevas a las que ya existen. Como `Products` y
 *   `Screenshots` ya estaban creadas, Sequelize consultaba campos inexistentes
 *   y Postgres respondía «no existe la columna "steam_appid"».
 *   La alternativa `sync({ alter: true })` se descartó a propósito: rehace la
 *   tabla completa en cada arranque y con developed datos es un riesgo.
 *
 * Todas las sentencias son idempotentes (`IF NOT EXISTS`), así que correrlas en
 * cada boot es seguro y no requiere que te acuerdes de ejecutarlas a mano.
 *
 * Para revertir a mano (dejás la tabla como estaba):
 *   ALTER TABLE "Products" DROP COLUMN steam_appid;  -- y los que siguen
 */

const COLUMNAS = [
  // --- Products: identidad de Steam + precio de referencia ------------------
  { tabla: 'Products', col: 'steam_appid', tipo: 'BIGINT' },
  { tabla: 'Products', col: 'steam_price_currency', tipo: 'VARCHAR(255)' },
  { tabla: 'Products', col: 'steam_price_original', tipo: 'INTEGER' },
  { tabla: 'Products', col: 'steam_price_final', tipo: 'INTEGER' },
  { tabla: 'Products', col: 'steam_discount_percent', tipo: 'INTEGER DEFAULT 0' },
  { tabla: 'Products', col: 'steam_price_expires', tipo: 'VARCHAR(255)' },
  { tabla: 'Products', col: 'developers', tipo: 'VARCHAR(255)' },
  { tabla: 'Products', col: 'publishers', tipo: 'VARCHAR(255)' },
  { tabla: 'Products', col: 'isFree', tipo: 'BOOLEAN DEFAULT false' },
  { tabla: 'Products', col: 'source', tipo: `VARCHAR(255) DEFAULT 'manual'` },
  { tabla: 'Products', col: 'last_synced_at', tipo: 'TIMESTAMP' },
  // --- Screenshots: orden y hash de la imagen ------------------------------
  { tabla: 'Screenshots', col: 'position', tipo: 'INTEGER DEFAULT 0' },
  { tabla: 'Screenshots', col: 'hash', tipo: 'VARCHAR(255)' },
];

/**
 * Ejecuta la migración.
 * @param {import('sequelize').Sequelize} sequelize
 */
async function run(sequelize) {
  const aplicadas = [];
  const omitidas = [];

  for (const { tabla, col, tipo } of COLUMNAS) {
    try {
      await sequelize.query(`ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "${col}" ${tipo};`);
      aplicadas.push(`${tabla}.${col}`);
    } catch (err) {
      // Si la tabla no existe todavía (base recién creada y sin sync), se
      // saltea: el próximo sync la crea completa y con todas las columnas.
      omitidas.push(`${tabla}.${col} (${err.original && err.original.code})`);
    }
  }

  // Índice único de steam_appid: es la clave del upsert. Varios NULL conviven
  // sin problema en Postgres, así que los juegos viejos (sin Steam) no molestan.
  let indice = 'sin tocar';
  try {
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "products_steam_appid_idx" ON "Products" ("steam_appid");`
    );
    indice = 'ok';
  } catch (err) {
    indice = `omitido (${err.original && err.original.code}: ${err.message.split('\n')[0]})`;
  }

  console.log(
    `[migrate 001] columnas aplicadas: ${aplicadas.length}` +
      (omitidas.length ? ` · omitidas: ${omitidas.length}` : '') +
      ` · índice steam_appid: ${indice}`
  );
  return { aplicadas, omitidas, indice };
}

module.exports = { run, COLUMNAS };