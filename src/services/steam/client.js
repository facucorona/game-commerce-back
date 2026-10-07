const axios = require('axios');
const { slugify } = require('./mapper');

/**
 * STEAM CLIENT
 * ----------------------------------------------------------------------------
 * Fuente de datos para el catálogo, ofertas, descripciones, imágenes y filtros.
 *
 * ¿Por qué Steam y no RAWG/IGDB?
 *   - No requiere API key ni cuenta de desarrollador (ni 2FA de Twitch).
 *   - Trae precio y descuento REAL por región (`cc`), que es lo que necesita una
 *     tienda.
 *   - Un solo endpoint de detalle trae descripción, fechas, plataformas, géneros,
 *     cover y capturas.
 *
 * Endpoints usados (todos públicos):
 *   1) Detalle de un juego  → /api/appdetails?appids=<id>&cc=<cc>
 *      ⚠️ Acepta UN SOLO appid por pedido: con varios devuelve HTTP 400.
 *      Es, con diferencia, el endpoint más estable: sigue sirviendo aunque los
 *      otros estén cortados.
 *   2) Búsqueda paginada    → /search/results/?...&infinite=1&json=1
 *      Devuelve { total_count, results_html }. Los appid van en el HTML como
 *      data-ds-appid="<id>" y el título en <span class="title">…</span>, así que
 *      se extraen con expresiones regulares (sin pedir un request por juego).
 *   3) Destacados           → /api/featuredcategories/?cc=<cc>
 *      Trae specials (ofertas), top_sellers, new_releases y coming_soon.
 *   4) SteamSpy (respaldo)  → steamspy.com/api.php?request=all&page=N
 *      Sólo sirve para SACAR appids, ordenados por cantidad de jugadores. Los
 *      datos de cada juego salen siempre de (1).
 *
 * ── Sobre el rate limit ──────────────────────────────────────────────────────
 * Steam no avisa: si te pasás, responde 200 con una página HTML titled
 * "Site Error" en lugar del JSON. Por eso acá:
 *   - se valida que la respuesta sea un objeto y no un string HTML,
 *   - ese caso se trata como error reintentable y además se pausa TODAS las
 *     requests un rato, para no seguir insistiendo y empeorar el bloqueo.
 * El ritmo por defecto es 1 request cada STEAM_MIN_INTERVAL_MS (600 ms) con un
 * poco de azar; bajarlo es la forma más fácil de ganarse un bloqueo.
 */

const CC = process.env.STEAM_CC || 'ar'; // región del precio
const LANG = process.env.STEAM_LANG || 'english';
const MIN_INTERVAL_MS = Number(process.env.STEAM_MIN_INTERVAL_MS || 600);
const TIMEOUT_MS = Number(process.env.STEAM_TIMEOUT_MS || 25000);
const MAX_RETRIES = Number(process.env.STEAM_MAX_RETRIES || 3);
// Cuánto se congela el cliente cuando Steam responde con HTML en vez de JSON.
const PAUSE_MS = Number(process.env.STEAM_RATE_LIMIT_PAUSE_MS || 45000);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- rate limiting

// Un único request a la vez, espaciado MIN_INTERVAL_MS (+ un poco de azar para
// no parecer un bot con reloj). Y si Steam nos corta, `pausaHasta` empuja todos
// los requests siguientes hacia atrás.
let cola = Promise.resolve();
let pausaHasta = 0;

function congelar(motivo) {
  pausaHasta = Date.now() + PAUSE_MS;
  console.warn(
    `[steam] ${motivo} · pausando requests ${Math.round(PAUSE_MS / 1000)}s ` +
      'para no empeorar el bloqueo'
  );
}

function encolar(fn) {
  const siguiente = cola.then(async () => {
    const resto = pausaHasta - Date.now();
    if (resto > 0) await sleep(resto);
    await sleep(MIN_INTERVAL_MS + Math.floor(Math.random() * 250));
    return fn();
  });
  // Si un pedido falla, la cadena no debe quedar rota.
  cola = siguiente.catch(() => {});
  return siguiente;
}

function esReintentable(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/** ¿La respuesta es JSON de verdad? (y no la página HTML de "Site Error") */
function esObjeto(valor) {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Error con flag `reintentable` para que el loop de reintentos sepa qué hacer. */
function errorRateLimit(mensaje) {
  const err = new Error(mensaje);
  err.reintentable = true;
  return err;
}

/** GET con reintentos y rate-limit. Lanza si se agotan los intentos. */
async function steamGet(url) {
  let ultimoError;

  for (let intento = 1; intento <= MAX_RETRIES; intento++) {
    try {
      const res = await encolar(() =>
        axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': UA, 'Accept-Language': LANG } })
      );
      return res.data;
    } catch (err) {
      ultimoError = err;
      const status = err.response && err.response.status;
      const hayBody = Boolean(err.response && err.response.data);

      // 4xx que no sea 429: no tiene sentido reintentar (appid inexistente, etc).
      if (status && !esReintentable(status)) {
        if (hayBody) return err.response.data; // 404 con cuerpo: se devuelve y el caller decide
        throw err;
      }
      if (intento < MAX_RETRIES) {
        const espera = 1200 * Math.pow(2, intento - 1) + Math.floor(Math.random() * 400);
        console.warn(`[steam] ${status || err.message} · reintento ${intento}/${MAX_RETRIES} en ${espera}ms`);
        await sleep(espera);
      }
    }
  }
  throw ultimoError;
}

/** GET que OBLIGA a devolver un objeto JSON. */
async function steamGetJson(url) {
  const data = await steamGet(url);
  if (esObjeto(data)) return data;
  congelar('Steam devolvió HTML en vez de JSON (¿bloqueo temporal?)');
  throw errorRateLimit('Steam respondió HTML en lugar de JSON');
}

/**
 * PUNTUACIÓN DE LOS USUARIOS DE STEAM (rating oficial).
 * ----------------------------------------------------------------------------
 * Steam calcula un puntaje de sus propios compradores y lo publica sin API key:
 *   /appreviews/<appid>?json=1&language=all&purchase_type=all
 * Devuelve `query_summary` con:
 *   review_score      → 0-10 (entero, el que muestra Steam en la ficha)
 *   review_score_desc → veredicto textual ("Overwhelmingly Positive", "Mixed"…)
 *   total_positive / total_negative / total_reviews → el detalle del cálculo
 *
 * Es la MISMA cola de rate limit que el resto (steamGetJson), y no es opcional:
 * este endpoint se bloquea MUCHO antes que los demás. Con 3-4 requests seguidas
 * responde 200 con `{"success": 8}` y ningún dato — esa es la señal de throttle,
 * no un juego sin reseñas. Por eso va por steamGetJson y se valida `success`.
 *
 * Ojo: NO se confunde `success: 8` (throttle, reintentable) con un juego que
 * realmente no tiene reseñas. En el segundo caso Steam responde `success: true`
 * con `total_reviews: 0`, y ahí sí el juego queda sin puntuar.
 *
 * @param {string|number} appid
 * @returns {Promise<{score:number|null, desc:string, reviews:number}>}
 */
async function appReviews(appid) {
  const url =
    `https://store.steampowered.com/appreviews/${appid}` +
    `?json=1&language=all&purchase_type=all`;
  const data = await steamGetJson(url);

  // success: 8 = throttle. Se trata como rate limit (congelar + reintentar)
  // para no seguir insistiendo y empeorar el bloqueo.
  if (data.success === 8) {
    congelar('appreviews devolvió success:8 (throttle)');
    throw errorRateLimit('Steam limitó /appreviews (success: 8)');
  }

  const q = (data && data.query_summary) || {};
  const total = Number(q.total_reviews) || 0;

  // Sin reseñas NO es un error: el juego queda sin puntuar y el front lo muestra
  // como "sin puntuar" en vez de 0 estrellas mudas.
  if (!q.review_score || total === 0) {
    return { score: null, desc: '', reviews: 0 };
  }

  return {
    score: Number(q.review_score),
    desc: String(q.review_score_desc || ''),
    reviews: total,
  };
}

/**
 * Detalle de UN juego.
 * @returns {object|null} datos del juego, o null si no existe / no tiene detalle.
 */
async function appDetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${CC}&l=${LANG}`;
  const data = await steamGetJson(url);
  const entry = data[appid] || data[String(appid)];
  if (!entry || entry.success !== true || !entry.data) return null;
  return entry.data;
}

/**
 * Una página del buscador de la tienda.
 * @param {object} opts
 * @param {number} [opts.start=0]  offset (0, 50, 100…)
 * @param {number} [opts.count=50] cantidad por página
 * @param {string} [opts.term]     texto a buscar
 * @param {string} [opts.filter]   topsellers | released | popularnew | specials
 * @param {number|string} [opts.tag]     id de tag/genio (122 = RPG)
 * @param {number|string} [opts.category1] categoría (998 = juegos, 1 = PC…)
 * @returns {Promise<{total:number, items:Array<{appid:string,titulo:string}>}>}
 */
async function searchPage({ start = 0, count = 50, term, filter, tag, category1 } = {}) {
  const params = new URLSearchParams({
    start: String(start),
    count: String(count),
    infinite: '1',
    cc: CC,
    l: LANG,
    json: '1',
  });
  if (term) params.append('term', term);
  if (filter) params.append('filter', filter);
  if (tag) params.append('tags', String(tag));
  if (category1) params.append('category1', String(category1));

  const url = `https://store.steampowered.com/search/results/?${params.toString()}`;
  const data = await steamGetJson(url);
  if (!data || !data.results_html) return { total: 0, items: [], appIds: [] };

  return { total: data.total_count || 0, ...parseResultados(data.results_html) };
}

/**
 * Del HTML de resultados saca { items: [{appid, titulo}], appIds }.
 *
 * Cada resultado es un <a …data-ds-appid="123"…> … <span class="title">Name</span>.
 * Se corta el HTML por bloques para poder emparejar el id con su título en la
 * misma pasada (así el re-etiquetado por nombre no necesita pedir el detalle de
 * cada candidato).
 */
function parseResultados(html) {
  const items = [];
  const appIds = [];
  const vistos = new Set();

  const bloques = String(html).split(/<a\s+href=/).slice(1);
  for (const bloque of bloques) {
    const id = (bloque.match(/data-ds-appid="(\d+)"/) || [])[1];
    if (!id || vistos.has(id)) continue;
    const titulo = (bloque.match(/<span class="title">([\s\S]*?)<\/span>/) || [])[1];
    vistos.add(id);
    appIds.push(id);
    items.push({ appid: id, titulo: titulo ? limpiarTitulo(titulo) : '' });
  }
  return { items, appIds };
}

/** "Counter-Strike&nbsp;2™" → "Counter-Strike 2" (sin entidades ni ™/®). */
function limpiarTitulo(t) {
  return String(t)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&trade;|&reg;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca un juego por nombre y devuelve el appid cuya título coincide EXACTO
 * (comparando slugs, que ignoran acentos, símbolos y mayúsculas).
 *
 * El match exacto es a propósito: si se aceptara el primer resultado, "Hades"
 * se le pegaría a "Hades II" y el catálogo quedaría con el género equivocado.
 * @returns {Promise<string|null>}
 */
async function buscarAppidPorNombre(nombre) {
  if (!nombre) return null;
  const objetivo = slugify(nombre);
  if (!objetivo) return null;

  const { items } = await searchPage({ term: nombre, count: 20 });
  const exacto = items.find((i) => i.titulo && slugify(i.titulo) === objetivo);
  return exacto ? exacto.appid : null;
}

/** Listados destacados: ofertas, más vendidos, novedades y próximos estrenos. */
async function featured() {
  const url = `https://store.steampowered.com/api/featuredcategories/?cc=${CC}&l=${LANG}`;
  const data = await steamGetJson(url);

  const lista = (k) => (Array.isArray(data[k] && data[k].items) ? data[k].items : []);
  return {
    specials: lista('specials'),
    top_sellers: lista('top_sellers'),
    new_releases: lista('new_releases'),
    coming_soon: lista('coming_soon'),
  };
}

/**
 * SteamSpy: 1000 appids por página, ordenados por cantidad de jugadores.
 * Es el RESPALDO del relevamiento: cuando Steam corta `search`, esta fuente
 * sigue andando porque es otro dominio. Sólo aporta ids (el resto sale de
 * appdetails). Con STEAM_DISCOVERY=none se desactiva.
 * @returns {Promise<string[]>}
 */
async function steamSpyPage(page = 0) {
  if (process.env.STEAM_DISCOVERY === 'none') return [];
  const url = `https://steamspy.com/api.php?request=all&page=${page}`;
  const data = await steamGetJson(url);
  return Object.keys(data).filter((k) => /^\d+$/.test(k));
}

module.exports = {
  appDetails,
  appReviews,
  searchPage,
  buscarAppidPorNombre,
  featured,
  steamSpyPage,
  steamGet,
  steamGetJson,
  esObjeto,
  parseResultados,
  CC,
  LANG,
  MIN_INTERVAL_MS,
  PAUSE_MS,
};