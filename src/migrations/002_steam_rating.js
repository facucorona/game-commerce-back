/**
 * MIGRACIÓN 002 — rating oficial de Steam
 * ----------------------------------------------------------------------------
 * El catálogo venía con `rating` en escala 0-100 (herencia de RAWG) y los juegos
 * importados de Steam lo tenían en 0, porque `mapper.js` no tenía fuente para
 * llenarlo. Eso producía tarjetas con 0 estrellas o con el badge desbordado
 * (`10/6`).
 *
 * Steam sí publica el puntaje de sus usuarios, sin API key:
 *   /appreviews/<appid>?json=1  →  review_score (0-10) + review_score_desc
 *
 * Se guarda en columnas PROPIAS y no se pisa `rating`: el rating legacy sigue
 * existiendo para el panel admin, pero el catálogo lee lo oficial.
 *
 * Igual que la 001, todo es idempotente (`IF NOT EXISTS`) y corre en cada boot.
 *
 * Para revertir a mano:
 *   ALTER TABLE "Products" DROP COLUMN steam_rating_score;
 *   ALTER TABLE "Products" DROP COLUMN steam_rating_desc;
 *   ALTER TABLE "Products" DROP COLUMN steam_rating_reviews;
 */

const COLUMNAS = [
  // Puntaje 0-10 de Steam (el "review_score"). NULL = el juego no tiene reseñas.
  { tabla: 'Products', col: 'steam_rating_score', tipo: 'FLOAT' },
  // Veredicto textual ("Very Positive", "Mixed"…). Va como referencia legible.
  { tabla: 'Products', col: 'steam_rating_desc', tipo: 'VARCHAR(255)' },
  // Cantidad de reseñas: sin esto no se puede distinguir "3 estrellas de 5" de
  // "3 estrellas de 5 pero de 2 personas", que no es lo mismo.
  { tabla: 'Products', col: 'steam_rating_reviews', tipo: 'INTEGER DEFAULT 0' },
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
      // Tabla inexistente todavía (base recién creada): el próximo sync la crea
      // completa y con todas las columnas.
      omitidas.push(`${tabla}.${col} (${err.original && err.original.code})`);
    }
  }

  console.log(
    `[migrate 002] columnas de rating aplicadas: ${aplicadas.length}` +
      (omitidas.length ? ` · omitidas: ${omitidas.length}` : '')
  );
  return { aplicadas, omitidas };
}

module.exports = { run, COLUMNAS };