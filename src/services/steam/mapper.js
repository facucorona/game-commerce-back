/**
 * MAPPER: Steam → modelos del proyecto
 * ----------------------------------------------------------------------------
 * Traduce el payload de Steam a los campos que ya usan Products, Screenshots,
 * Genre, Platforms, UsedGenre y UsedPlatforms. Si mañana cambia el proveedor,
 * solo se toca este archivo (y el service que lo llama).
 *
 * Decisiones importantes:
 *  - `price` (tu precio de venta) NO se toca: lo definís vos. El precio de Steam
 *    se guarda aparte en steam_price_* para poder mostrarlo como referencia.
 *  - Steam no tiene ESRB ni Metacritic: se completan con defaults para no
 *    romper los campos obligatorios del modelo.
 *  - `released` es STRING en tu modelo, así que se normaliza a ISO (YYYY-MM-DD).
 */

const DEFAULT_COVER = 'https://store.steampowered.com/images/defaultsteam.jpg';

/** Quita HTML y entities comunes (las descripciones de Steam traen <br>, <i>…) */
function limpiarHtml(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** "Half-Life®: Alyx" → "half-life-alyx" */
function slugify(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Steam devuelve "9 Dec, 2020" → "2020-12-09" */
function normalizarFecha(fecha) {
  if (!fecha) return new Date().toISOString().slice(0, 10);
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Plataformas de Steam → las que usa tu DB (PC / Xbox / PlayStation) */
function mapearPlataformas(platforms = {}) {
  const lista = [];
  const activas = Object.keys(platforms || {}).filter((k) => platforms[k]);
  if (activas.includes('windows')) lista.push('PC');
  if (activas.includes('mac')) lista.push('Mac');
  if (activas.includes('linux')) lista.push('Linux');
  return lista;
}

/** Quita capturas duplicadas y descarta las que no son http(s). */
function limpiarCapturas(lista = [], max = 5) {
  const vistas = new Set();
  const out = [];
  for (const captura of lista) {
    const url = captura && typeof captura === 'object' ? captura.path_full || captura.path_medium : captura;
    if (!url || !/^https?:\/\//.test(url) || vistas.has(url)) continue;
    vistas.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Géneros de Steam → nombres consistentes con los del proyecto.
 *
 * Se reaprovecha el vocabulario que YA tenía la base (que venía de RAWG) en
 * lugar de inventar nombres paralelos: si Steam dice "RPG" y la base ya tiene
 * un género "RPG", se reusa ese; si no, se crea el nuevo. Si se dejaran los dos
 * ("RPG" y "Role Playing") el filtro de la tienda mostraría dos opciones que
 * significan lo mismo.
 */
function mapearGeneros(genres = []) {
  const MAPA = {
    Action: 'Action',
    Adventure: 'Adventure',
    'Massively Multiplayer': 'Massively Multiplayer',
    RPG: 'RPG', // el que ya usa la base
    Simulation: 'Simulation',
    Strategy: 'Strategy', // también está en la base
    Sports: 'Sports',
    Racing: 'Racing',
    'Early Access': 'Early Access',
    'Free to Play': 'Free to Play',
  };

  // OJO: Steam manda los géneros como objetos `{ id, description }`, no como
  // strings. Si se pasa el objeto entero como valor del `where` de un
  // findOrCreate, Sequelize intenta escapar un objeto y revienta con
  // «Invalid value { id: '1' }». Por eso se normaliza a texto y se deduplica.
  return Array.from(
    new Set(
      (genres || [])
        .map((g) => (typeof g === 'string' ? g : g && g.description))
        .filter(Boolean)
        .map((nombre) => MAPA[nombre] || nombre)
    )
  );
}

/**
 * Datos de Steam → objeto con los campos de Products.
 * @param {object} d  data de /api/appdetails
 * @param {string|number} appid
 * @param {number} [maxScreenshots=5]
 */
function toProduct(d, appid, maxScreenshots = 5) {
  const nombre = d.name || `Steam ${appid}`;
  const descripcion = limpiarHtml(d.short_description || d.about_the_game || '') || 'Sin descripción.';
  const precio = d.price_overview || {};

  return {
    steam_appid: String(appid),
    name: nombre,
    slug: slugify(nombre),
    description: descripcion.slice(0, 2000),
    // Rating: Steam no publica un puntaje 0-100 (su endpoint de reviews es otro
    // y cuesta una request extra por juego), así que se usa Metacritic cuando
    // existe y 0 (= "sin dato") cuando no. Antes se usaba la cantidad de
    // recomendaciones, que es un contador de ventas y dejaba 100 en todos los
    // juegos: information, pero inútil. Si más adelante querés el puntaje real,
    // el endpoint es /appreviews/<appid>?json=1 (total_positive/total_reviews).
    rating: 0,
    metacriticRating: d.metacritic ? d.metacritic.score : 0,
    esrb_rating: 'Rating Pending', // Steam no tiene ESRB
    background_image: d.header_image || DEFAULT_COVER,
    released: normalizarFecha(d.release_date && d.release_date.date),
    requeriments_min: 'Has no Requeriments',
    requeriments_recomended: 'Has no Requeriments',
    developers: Array.isArray(d.developers) ? d.developers.join(', ') : '',
    publishers: Array.isArray(d.publishers) ? d.publishers.join(', ') : '',
    source: 'steam',
    // Precio de REFERENCIA de Steam. Tu `price` de venta no se pisa.
    steam_price_currency: precio.currency || null,
    steam_price_original: precio.initial ? Math.round(precio.initial) : null,
    steam_price_final: precio.final ? Math.round(precio.final) : null,
    steam_discount_percent: precio.discount_percent || 0,
    steam_price_expires: precio.date || null,
    onSale: Boolean(precio.discount_percent && precio.discount_percent > 0),
    isDisabled: d.is_release_unavailable === true,
    // OJO con el nombre: `is_free` de Steam no significa "free-to-play" en el
    // sentido del gamer, significa que Steam no te lo vende. Comprobado:
    // War Thunder, Crossout, Destiny 2 y Lost Ark llegan con is_free=true y sin
    // `price_overview` porque en Argentina se venden fuera de la tienda de Steam
    // (launcher propio o Epic). Para saber si el juego tiene precio de
    // referencia hay que mirar `steam_price_final`.
    isFree: d.is_free === true,
    genres: mapearGeneros(d.genres || []),
    platforms: mapearPlataformas(d.platforms || {}),
    screenshots: limpiarCapturas(d.screenshots || [], maxScreenshots),
  };
}

/** Hash simple y estable para detectar si una imagen cambió (sin crypto) */
function hashTexto(texto) {
  let h = 5381;
  const s = String(texto || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

/** Descripción larga normalizada: sin HTML y recortada */
function limpiarDescripcionLarga(texto, max = 600) {
  const t = limpiarHtml(texto).replace(/\n{3,}/g, '\n\n');
  return t.length > max ? t.slice(0, max) + '…' : t;
}

module.exports = {
  toProduct,
  slugify,
  normalizarFecha,
  mapearPlataformas,
  mapearGeneros,
  limpiarCapturas,
  limpiarHtml,
  limpiarDescripcionLarga,
  hashTexto,
  DEFAULT_COVER,
};
