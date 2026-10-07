/**
 * SYNC SERVICE — importa/actualiza el catálogo y las ofertas desde Steam.
 * ----------------------------------------------------------------------------
 * Reglas duras de este servicio:
 *  1. Nunca toca usuarios, carritos, órdenes ni reseñas.
 *  2. Nunca pisa `price` (tu precio de venta): el de Steam va a steam_price_*.
 *     La única excepción es el ALTA de un juego nuevo, que propone el precio de
 *     Steam como punto de partida (desactivable con STEAM_PRECIO_EQUIVALENCIA).
 *  3. El identificador externo es `steam_appid`: si ya existe, ACTUALIZA; si no,
 *     CREA. Nunca duplica.
 *  4. Deja una fila en SyncRun por corrida (con errores incluidos).
 *  5. Es secuencial y espaciado (ver client.js): una request cada ~600 ms.
 *
 * Funciones públicas (las usa el controller /steam-sync):
 *   syncCatalogo()        importa/actualiza juegos (relevamiento o lista fija)
 *   syncOfertas()         refresca precio y descuento de lo ya importado
 *   reEtiquetarPorNombre() engancha géneros/plataformas por nombre
 *   estado()              resumen + últimas corridas
 */

const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const client = require('./client');
const { toProduct, hashTexto, DEFAULT_COVER } = require('./mapper');

// Caché local de appids relevados. Sirve para no depender de que Steam no nos
// esté cortando el buscador, y para no pegarle al catálogo en cada corrida (los
// appid se agregan lento: los más vendidos no cambian cada semana).
const CACHE_PATH = process.env.STEAM_APPID_CACHE || path.join(__dirname, 'appids-cache.json');

let db = null;
function setDB(mod) {
  db = mod;
}

function modelos() {
  if (!db) throw new Error('sync: DB no inicializada (falta setDB)');
  return {
    Products: db.Products,
    Screenshots: db.Screenshots,
    Genre: db.Genre,
    Platforms: db.Platforms,
    UsedGenre: db.UsedGenre,
    UsedPlatforms: db.UsedPlatforms,
    SyncRun: db.SyncRun,
  };
}

// Un solo sync a la vez (protege contra el tablero + un click manual simultáneos)
let corriendo = false;
function estaCorriendo() {
  return corriendo;
}

// ------------------------------------------------------------------ caché

/** Lee la caché de appids del disco (si existe). Nunca tira si está corrupta. */
function leerCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return [];
    const datos = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    return Array.isArray(datos.appIds) ? datos.appIds : [];
  } catch (err) {
    console.warn('[sync] caché de appids ilegible:', err.message);
    return [];
  }
}

/** Guarda la caché (silenciosa: que falle el disco no es motivo para cortar). */
function guardarCache(appIds, extra = {}) {
  try {
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ actualizado: new Date().toISOString(), appIds, ...extra }, null, 0),
      'utf8'
    );
    console.log(`[sync] caché guardada: ${appIds.length} appids → ${CACHE_PATH}`);
  } catch (err) {
    console.warn('[sync] no se pudo guardar la caché:', err.message);
  }
}

// ------------------------------------------------------------- relevamiento

/**
 * Genera los appids del catálogo, probando las fuentes en cascada.
 *
 * El orden importa porque a Steam antes le cortan el buscador que el detalle:
 *   1. lista explícita (STEAM_APPIDS=730,440,570): pruebas y cargas a mano
 *   2. caché local del relevamiento anterior
 *   3. búsqueda oficial de la tienda, mezclando listas y géneros
 *   4. SteamSpy (otro dominio: sigue vivo cuando Steam corta el buscador)
 *
 * Para qué mezclar listas: `topsellers` trae superventas y `tag_*` un solo
 * género; la mezcla da variedad sin pelearse con los filtros de la tienda.
 */
async function relevarAppids(limite) {
  const manual = (process.env.STEAM_APPIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  if (manual.length) {
    console.log(`[sync] lista manual: ${manual.length} appids (STEAM_APPIDS)`);
    return manual.slice(0, limite);
  }

  const cacheados = leerCache();
  if (cacheados.length >= limite) {
    console.log(`[sync] usando caché local: ${limite}/${cacheados.length} appids`);
    return cacheados.slice(0, limite);
  }

  const fuentes = [
    { label: 'topsellers', opts: { filter: 'topsellers' } },
    { label: 'released', opts: { filter: 'released' } },
    { label: 'popularnew', opts: { filter: 'popularnew' } },
    { label: 'tag_rpg', opts: { tag: 122 } },
    { label: 'tag_action', opts: { tag: 1 } },
    { label: 'tag_indie', opts: { tag: 492 } },
  ];

  const vistos = new Set();
  const appids = [];

  for (const fuente of fuentes) {
    if (appids.length >= limite) break;
    try {
      const start = await client.searchPage({ start: 0, count: 50, ...fuente.opts });
      let agregados = 0;
      for (const id of start.appIds) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        appids.push(id);
        agregados++;
        if (appids.length >= limite) break;
      }
      console.log(`[sync] ${fuente.label}: +${agregados} (total ${appids.length}/${limite})`);
    } catch (err) {
      // Un origen caído no corta el relevamiento: se avisa y se sigue con el
      // siguiente. Si TODOS fallan, entra el respaldo de abajo.
      console.warn(`[sync] no se pudo relevar ${fuente.label}: ${err.message}`);
    }
  }

  if (appids.length < limite) {
    try {
      const faltantes = limite - appids.length;
      const extras = await client.steamSpyPage(0);
      let agregados = 0;
      for (const id of extras) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        appids.push(id);
        agregados++;
        if (agregados >= faltantes) break;
      }
      console.log(`[sync] steamspy (respaldo): +${agregados} (total ${appids.length}/${limite})`);
    } catch (err) {
      console.warn(`[sync] el respaldo de SteamSpy tampoco respondió: ${err.message}`);
    }
  }

  if (appids.length) guardarCache(appids, { limite });

  // Último recurso: lo que ya esté en la base, para que una recarga no quede en 0.
  if (!appids.length) {
    try {
      const enBase = await db.Products.findAll({
        attributes: ['steam_appid'],
        where: { steam_appid: { [Op.ne]: null } },
        limit,
      });
      const ids = enBase.map((p) => String(p.steam_appid));
      if (ids.length) console.log(`[sync] sin fuentes disponibles: refrescando ${ids.length} juegos ya importados`);
      return ids;
    } catch (err) {
      console.warn('[sync] tampoco se pudo leer la base:', err.message);
    }
  }

  return appids;
}

// -------------------------------------------------------------- taxonomías

/**
 * Crea/actualiza plataformas y géneros (tabla base + "usados" para los filtros).
 * Devuelve las dos funciones de "asegurar" que usan las sincronizaciones.
 */
async function sincronizarTaxonomias({ Platforms, UsedPlatforms, Genre, UsedGenre }) {
  // Plataformas: `image_background` es NOT NULL en tu modelo, por eso el fallback.
  const fallbackPlataforma = 'https://store.steampowered.com/images/defaultsteam.jpg';

  const asegurarPlataforma = async (nombre) => {
    const [plataforma] = await Platforms.findOrCreate({
      where: { name: nombre },
      defaults: { name: nombre, image_background: fallbackPlataforma },
    });
    await UsedPlatforms.findOrCreate({ where: { name: nombre }, defaults: { name: nombre } });
    return plataforma;
  };

  const asegurarGenero = async (nombre) => {
    const [genero] = await Genre.findOrCreate({ where: { name: nombre }, defaults: { name: nombre } });
    await UsedGenre.findOrCreate({ where: { name: nombre }, defaults: { name: nombre } });
    return genero;
  };

  return { asegurarPlataforma, asegurarGenero };
}

/** Asocia capturas al producto (findOrCreate por URL + hash/posición). */
async function sincronizarCapturas(producto, urls, { Screenshots }) {
  if (!producto || !Array.isArray(urls)) return 0;
  let guardadas = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    try {
      const [shot, creado] = await Screenshots.findOrCreate({
        where: { image: url },
        defaults: { image: url, position: i, hash: hashTexto(url) },
      });
      if (!creado) {
        await shot.update({ position: i, hash: hashTexto(url) });
      }
      await producto.addScreenshots(shot);
      guardadas++;
    } catch (err) {
      console.warn(`[sync] captura ${url} falló: ${err.message}`);
    }
  }
  return guardadas;
}

/**
 * Sincroniza UN juego de Steam (crear o actualizar + imágenes y etiquetas).
 *
 * Vive suelto para que lo reutilicen el catálogo y el re-etiquetado por nombre:
 * los dos caminos hacen exactamente lo mismo, que es la idea (si cambia el
 * catálogo, el re-etiquetado no puede quedar viejo).
 *
 * @param {string|number} appid
 * @param {object} opts
 * @param {number} [opts.maxScreenshots=5]
 * @param {object} [opts.M] modelos ya resueltos
 * @param {object} opts.taxos resultado de sincronizarTaxonomias()
 * @returns {Promise<{estado:'creado'|'actualizado'|'omitido', nombre?:string}>}
 */
async function sincronizarUnJuego(appid, { maxScreenshots = 5, M = modelos(), taxos } = {}) {
  const { Products, Screenshots } = M;
  const { asegurarPlataforma, asegurarGenero } = taxos;

  const data = await client.appDetails(appid);
  if (!data) return { estado: 'omitido' };

  // RATING OFICIAL DE STEAM (/appreviews). Va aparte del detalle a propósito:
  // si este request falla o te limitan, el juego se importa igual con todos sus
  // datos y queda SIN puntuar. Perder el rating es mucho mejor que perder el
  // juego entero por un endpoint que se bloquea con pocas requests seguidas.
  let reviews = null;
  try {
    reviews = await client.appReviews(appid);
  } catch (err) {
    console.warn(`[sync] rating de ${appid} no se pudo leer: ${err.message}`);
  }

  const mapeado = toProduct(data, appid, maxScreenshots, reviews);
  const existente = await Products.findOne({ where: { steam_appid: mapeado.steam_appid } });

  // Campos que el sync puede pisar. `price` NO está en la lista a propósito.
  const campos = {
    name: mapeado.name,
    slug: mapeado.slug,
    description: mapeado.description,
    // `rating` llega en 0 cuando la fuente no lo trae. Meter un 0 arriba
    // borraría el valor cargado a mano, así que sólo se escribe cuando hay dato.
    ...(mapeado.rating > 0 ? { rating: mapeado.rating } : {}),
    // Rating oficial de Steam. Sólo se escribe si el request funcionó: si vino
    // null (juego sin reseñas) se deja el valor anterior en vez de borrarlo.
    ...(mapeado.steam_rating_score != null
      ? {
          steam_rating_score: mapeado.steam_rating_score,
          steam_rating_desc: mapeado.steam_rating_desc,
          steam_rating_reviews: mapeado.steam_rating_reviews,
        }
      : {}),
    metacriticRating: mapeado.metacriticRating,
    background_image: mapeado.background_image || DEFAULT_COVER,
    released: mapeado.released,
    developers: mapeado.developers,
    publishers: mapeado.publishers,
    source: 'steam',
    steam_price_currency: mapeado.steam_price_currency,
    steam_price_original: mapeado.steam_price_original,
    steam_price_final: mapeado.steam_price_final,
    steam_discount_percent: mapeado.steam_discount_percent,
    steam_price_expires: mapeado.steam_price_expires,
    onSale: mapeado.onSale,
    isDisabled: mapeado.isDisabled,
    isFree: mapeado.isFree,
    last_synced_at: new Date(),
  };

  let producto;
  if (existente) {
    await existente.update(campos);
    producto = existente;
  } else {
    // PRECIO DE VENTA EN EL ALTA.
    // `price` nunca se actualiza (ahí está tu margen), pero en el alta se propone
    // el precio de Steam para que el catálogo no aparezca con precio 0 y el
    // carrito no pueda agregar un juego gratis.
    //
    // OJO sobre la moneda: Steam hoy responde en USD para cc=ar (Argentina ya no
    // tiene precios en pesos en Steam), así que este número es el precio en
    // dólares. Queda registrado en steam_price_currency para poder revisarlo. Con
    // STEAM_PRECIO_EQUIVALENCIA=false el alta usa 0 y lo cargás vos.
    const precioPropuesto =
      process.env.STEAM_PRECIO_EQUIVALENCIA === 'false' || !mapeado.steam_price_final
        ? 0
        : mapeado.steam_price_final;

    producto = await Products.create({
      ...campos,
      steam_appid: mapeado.steam_appid,
      price: precioPropuesto,
    });
  }

  await sincronizarCapturas(producto, mapeado.screenshots, { Screenshots });

  for (const nombrePlataforma of mapeado.platforms) {
    const plataforma = await asegurarPlataforma(nombrePlataforma);
    await producto.addPlatforms(plataforma);
  }
  for (const nombreGenero of mapeado.genres) {
    const genero = await asegurarGenero(nombreGenero);
    await producto.addGenre(genero);
  }

  return { estado: existente ? 'actualizado' : 'creado', nombre: mapeado.name };
}

/**
 * Sincronización de CATÁLOGO: crea/actualiza juegos con sus imágenes y filtros.
 * @param {object} opts
 * @param {number} [opts.limit=200]
 * @param {number} [opts.maxScreenshots=5]
 * @param {string[]} [opts.appids] lista explícita (tiene prioridad sobre limit)
 */
async function syncCatalogo({ limit = 200, maxScreenshots = 5, appids: appidsForzados } = {}) {
  const M = modelos();
  const { SyncRun } = M;
  const taxos = await sincronizarTaxonomias(M);

  const run = await SyncRun.create({ type: 'catalog', status: 'running' });
  const errores = [];
  const cuenta = { creados: 0, actualizados: 0, omitidos: 0 };

  try {
    const appids = appidsForzados && appidsForzados.length ? appidsForzados : await relevarAppids(limit);
    console.log(`[sync] catálogo: ${appids.length} appids a procesar`);

    // `sincronizarUnJuego` devuelve el estado en singular ('creado') y los
    // contadores van en plural ('creados'). Sin este mapa se contam en claves
    // que no existen y el resumen de la corrida sale siempre en cero.
    const CLAVE_ESTADO = { creado: 'creados', actualizado: 'actualizados', omitido: 'omitidos' };

    for (const appid of appids) {
      try {
        const r = await sincronizarUnJuego(appid, { maxScreenshots, M, taxos });
        const clave = CLAVE_ESTADO[r.estado];
        if (clave) cuenta[clave]++;
        // Log por juego: en una corrida de 200 juegos y varios minutos es la
        // única forma de ver por dónde iba sin adivinar.
        console.log(`[sync] ${appid}: ${r.estado}${r.nombre ? ' · ' + r.nombre : ''}`);
      } catch (err) {
        cuenta.omitidos++;
        errores.push(`${appid}: ${err.message}`);
        // Con STEAM_DEBUG_STACK=true se imprime el stack completo del error,
        // que si no sólo queda reducido al texto de `errores`.
        if (process.env.STEAM_DEBUG_STACK === 'true') console.error(err.stack);
      }
    }

    const { creados, actualizados, omitidos } = cuenta;
    await run.update({
      status: errores.length && creados + actualizados === 0 ? 'error' : 'ok',
      finished_at: new Date(),
      created_count: creados,
      updated_count: actualizados,
      skipped_count: omitidos,
      error_count: errores.length,
      detail: JSON.stringify({ limit, maxScreenshots, errores: errores.slice(0, 20) }),
    });
    console.log(`[sync] catálogo listo: ${creados} creados · ${actualizados} actualizados · ${omitidos} omitidos`);
    return { runId: run.id, creados, actualizados, omitidos, errores };
  } catch (err) {
    await run.update({
      status: 'error',
      finished_at: new Date(),
      error_count: errores.length + 1,
      detail: String(err.message),
    });
    throw err;
  }
}

/**
 * Sincronización de OFERTAS: refresca precio/descuento de los juegos ya
 * importados. No crea juegos nuevos: sólo actualiza los que tienen steam_appid.
 */
async function syncOfertas({ soloEnOferta = false } = {}) {
  const M = modelos();
  const { Products, SyncRun } = M;

  const run = await SyncRun.create({ type: 'offers', status: 'running' });
  const errores = [];
  let actualizados = 0;
  let omitidos = 0;

  try {
    const where = { steam_appid: { [Op.ne]: null } };
    if (soloEnOferta) where.onSale = true;

    // Orden por `last_synced_at`: los más viejos se refrescan primero.
    const productos = await Products.findAll({ where, limit: 500, order: [['last_synced_at', 'ASC']] });
    console.log(`[sync] ofertas: ${productos.length} juegos con steam_appid`);

    // Los destacados de Steam traen el vencimiento del descuento sin gastar una
    // request por juego: se usan como respaldo cuando el detalle no lo trae.
    let expiraciones = {};
    try {
      const f = await client.featured();
      (f.specials || []).forEach((s) => {
        if (s.id && s.discount_expiration) expiraciones[String(s.id)] = s.discount_expiration;
      });
    } catch (err) {
      console.warn('[sync] no se pudieron leer los destacados:', err.message);
    }

    for (const producto of productos) {
      try {
        const data = await client.appDetails(producto.steam_appid);
        if (!data) {
          omitidos++;
          continue;
        }
        const po = data.price_overview || {};
        const descuento = po.discount_percent || 0;

        const campos = {
          steam_price_currency: po.currency || null,
          steam_price_original: po.initial ? Math.round(po.initial) : null,
          steam_price_final: po.final ? Math.round(po.final) : null,
          steam_discount_percent: descuento,
          steam_price_expires: po.date || expiraciones[String(producto.steam_appid)] || null,
          onSale: descuento > 0,
          isFree: data.is_free === true,
          background_image: data.header_image || producto.background_image,
          last_synced_at: new Date(),
        };

        // RATING junto al precio: es lo otro que cambia seguido, y la corrida
        // de ofertas (cada 12 h) ya está pagándole el costo a Steam por juego.
        // Se refresca sólo si el request éxito: si te limitan, el precio se
        // guarda igual y el rating queda como estaba.
        try {
          const reviews = await client.appReviews(producto.steam_appid);
          if (reviews && reviews.score != null) {
            campos.steam_rating_score = reviews.score;
            campos.steam_rating_desc = reviews.desc;
            campos.steam_rating_reviews = reviews.reviews;
          }
        } catch (err) {
          console.warn(`[sync] ${producto.steam_appid}: rating no actualizado (${err.message})`);
        }

        await producto.update(campos);
        actualizados++;
      } catch (err) {
        omitidos++;
        errores.push(`${producto.steam_appid}: ${err.message}`);
      }
    }

    await run.update({
      status: errores.length && actualizados === 0 ? 'error' : 'ok',
      finished_at: new Date(),
      updated_count: actualizados,
      skipped_count: omitidos,
      error_count: errores.length,
      detail: JSON.stringify({ soloEnOferta, errores: errores.slice(0, 20) }),
    });
    console.log(`[sync] ofertas listo: ${actualizados} actualizados · ${omitidos} omitidos`);
    return { runId: run.id, actualizados, omitidos, errores };
  } catch (err) {
    await run.update({
      status: 'error',
      finished_at: new Date(),
      error_count: errores.length + 1,
      detail: String(err.message),
    });
    throw err;
  }
}

/**
 * RE-ETIQUETAR POR NOMBRE — busca cada juego del catálogo en Steam y le engancha
 * su appid, sus géneros y sus plataformas.
 *
 * ¿Para qué existe? Un catálogo que viene de otra fuente (RAWG, carga manual)
 * puede tener juegos sin tags: los filtros de género/plataforma los muestran
 * como "sin clasificar" y los de esa plataforma no devuelven nada.
 *
 * Reglas: busca por nombre y EXIGE coincidencia exacta de slug (así "Hades" no
 * se le pega a "Hades II"); nunca crea juegos, sólo etiqueta los existentes.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]
 * @param {boolean} [opts.soloSinGenero=true] acotar a los que están sin género
 */
async function reEtiquetarPorNombre({ limit = 100, soloSinGenero = true } = {}) {
  const M = modelos();
  const { Products, SyncRun } = M;
  const taxos = await sincronizarTaxonomias(M);

  const run = await SyncRun.create({ type: 'retag', status: 'running' });
  const errores = [];
  const emparejados = [];
  let sinCoincidencia = 0;

  try {
    // Candidatos: los que todavía no tienen appid de Steam.
    const candidatos = await Products.findAll({
      where: { steam_appid: null },
      attributes: ['id', 'name', 'slug'],
      limit,
      order: [['name', 'ASC']],
    });

    // Con soloSinGenero se descartan los que ya tienen al menos un género: son
    // los que no están rota y no vale la pena gastar requests en ellos.
    let lista = candidatos;
    if (soloSinGenero && candidatos.length) {
      const conGenero = await Products.findAll({
        attributes: ['id'],
        include: [{ model: M.Genre, through: { attributes: [] }, required: true }],
        limit: 1000,
      });
      const conGeneroIds = new Set(conGenero.map((p) => p.id));
      lista = candidatos.filter((p) => !conGeneroIds.has(p.id));
    }

    console.log(`[sync] re-etiquetado: ${lista.length} de ${candidatos.length} candidatos`);

    for (const producto of lista) {
      try {
        const appid = await client.buscarAppidPorNombre(producto.name);
        if (!appid) {
          sinCoincidencia++;
          continue;
        }
        // Se ata el appid antes de sincronizar para que el juego se actualice en
        // su lugar (y no se cree un duplicado con otro nombre).
        await producto.update({ steam_appid: appid });
        await sincronizarUnJuego(appid, { maxScreenshots: 3, M, taxos });
        emparejados.push({ nombre: producto.name, appid });
        console.log(`[sync] re-etiquetado: ${producto.name} → ${appid}`);
      } catch (err) {
        errores.push(`${producto.name}: ${err.message}`);
      }
    }

    await run.update({
      status: errores.length && !emparejados.length ? 'error' : 'ok',
      finished_at: new Date(),
      created_count: 0,
      updated_count: emparejados.length,
      skipped_count: sinCoincidencia,
      error_count: errores.length,
      detail: JSON.stringify({ emparejados: emparejados.slice(0, 40), errores: errores.slice(0, 20) }),
    });
    console.log(
      `[sync] re-etiquetado listo: ${emparejados.length} emparejados · ` +
        `${sinCoincidencia} sin coincidencia exacta · ${errores.length} errores`
    );
    return { runId: run.id, emparejados, sinCoincidencia, errores };
  } catch (err) {
    await run.update({
      status: 'error',
      finished_at: new Date(),
      error_count: errores.length + 1,
      detail: String(err.message),
    });
    throw err;
  }
}

/** Resumen + últimas corridas (para el panel admin). */
async function estado({ limite = 10 } = {}) {
  const M = modelos();
  const runs = await M.SyncRun.findAll({ order: [['started_at', 'DESC']], limit: limite });
  const totalConSteam = await M.Products.count({ where: { steam_appid: { [Op.ne]: null } } });
  const enOferta = await M.Products.count({ where: { onSale: true } });
  const totalProductos = await M.Products.count();

  // Cuántos quedan sin género: es el trabajo pendiente del re-etiquetado.
  // OJO: con un `include` Sequelize cuenta FILAS de la unión, no productos, así
  // que sin `distinct: true, col: 'id'` un juego con 4 géneros se cuenta 4 veces
  // y el "sin género" da 0 siempre (falso positivo).
  const conGenero = await M.Products.count({
    distinct: true,
    col: 'id',
    include: [{ model: M.Genre, through: { attributes: [] }, required: true }],
  });

  return {
    corriendo: corriendo,
    juegosTotales: totalProductos,
    juegosConSteam: totalConSteam,
    juegosEnOferta: enOferta,
    juegosConGenero: conGenero,
    juegosSinGenero: Math.max(0, totalProductos - conGenero),
    appidsEnCache: leerCache().length,
    ultimoCatalogo: runs.find((r) => r.type === 'catalog') || null,
    ultimaOferta: runs.find((r) => r.type === 'offers') || null,
    ultimoRetag: runs.find((r) => r.type === 'retag') || null,
    corridas: runs,
  };
}

/** Serializa las corridas: sólo uno a la vez. */
async function envolver(fn) {
  if (corriendo) throw new Error('Ya hay una sincronización en curso');
  corriendo = true;
  try {
    return await fn();
  } finally {
    corriendo = false;
  }
}

module.exports = {
  setDB,
  syncCatalogo: (opts) => envolver(() => syncCatalogo(opts)),
  syncOfertas: (opts) => envolver(() => syncOfertas(opts)),
  reEtiquetarPorNombre: (opts) => envolver(() => reEtiquetarPorNombre(opts)),
  estado,
  estaCorriendo,
  leerCache,
};