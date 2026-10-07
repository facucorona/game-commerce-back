/**
 * CONTROLLER del sincronizador de Steam (uso interno / panel admin)
 * ----------------------------------------------------------------------------
 * Rutas (todas requieren JWT porque NO están en PUBLIC_ROUTES del guard de
 * app.js, y además exigen isAdmin):
 *
 *   GET  /steam-sync            → estado: últimas corridas, cuántos juegos hay
 *   POST /steam-sync/catalog    → importa/actualiza el catálogo
 *   POST /steam-sync/offers     → refresca precios y descuentos
 *
 * Ejemplos (el token va en la query porque así lo lee el extractor del front):
 *   curl -X POST "http://localhost:3001/steam-sync/catalog?tkn=MI_TOKEN" \
 *        -H "Content-Type: application/json" -d '{"limit":5,"wait":true}'
 *   curl "http://localhost:3001/steam-sync?tkn=MI_TOKEN"
 *
 * `wait:false` (default) devuelve 202 al toque y la corrida sigue en segundo
 * plano: 200 juegos a ~600 ms por request es un par de minutos, más que lo que
 * aguanta un request HTTP colgado. Con `wait:true` se espera el resultado.
 */

const { Router } = require('express');
const db = require('../db');
const sync = require('../services/steam/syncService');

const router = Router();

/**
 * Middleware: sólo administradores.
 * OJO: el JWT de este proyecto se firma con { id, email } (ver loginUser.js),
 * así que `req.user.isAdmin` NO existe. Hay que volver a la tabla Users: es la
 * única fuente válida y además permite respetar un cambio de permisos al
 * instante, sin esperar a que expire el token.
 */
async function soloAdmin(req, res, next) {
  try {
    const id = req.user && req.user.id;
    if (!id) return res.status(401).json({ error: 'Sin token o token inválido' });

    const usuario = await db.Users.findOne({ where: { id } });
    if (!usuario) return res.status(401).json({ error: 'El usuario del token no existe' });
    if (usuario.isAdmin !== true) {
      return res.status(403).json({ error: 'Se requiere un usuario administrador' });
    }
    req.admin = usuario;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Todas las rutas de este archivo pasan por el control de admin.
router.use(soloAdmin);

/** Estado del sincronizador. */
router.get('/', async (req, res, next) => {
  try {
    const info = await sync.estado({ limite: Number(req.query.limite || 10) });
    res.json({
      scheduler: process.env.STEAM_SYNC_ENABLED === 'true' ? 'activo' : 'apagado',
      region: process.env.STEAM_CC || 'ar',
      corriendoAhora: info.corriendo,
      juegosConSteam: info.juegosConSteam,
      juegosEnOferta: info.juegosEnOferta,
      juegosTotales: info.juegosTotales,
      juegosConGenero: info.juegosConGenero,
      juegosSinGenero: info.juegosSinGenero,
      appidsEnCache: info.appidsEnCache,
      ultimoCatalogo: info.ultimoCatalogo,
      ultimaOferta: info.ultimaOferta,
      ultimoRetag: info.ultimoRetag,
      corridas: info.corridas,
    });
  } catch (err) {
    next(err);
  }
});

/** Importa / actualiza el catálogo desde Steam. */
router.post('/catalog', async (req, res, next) => {
  const body = req.body || {};
  const limit = Math.min(Math.max(Number(body.limit) || Number(process.env.STEAM_CATALOG_LIMIT || 200), 1), 500);
  const maxScreenshots = Math.min(Math.max(Number(body.maxScreenshots) || 5, 0), 10);
  const wait = body.wait === true || body.wait === 'true';
  // Lista explícita de appids: "730,440,570". Sirve para recargar juegos
  // puntualessin tocar el relevamiento general.
  const appids = String(body.appids || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));

  try {
    if (sync.estaCorriendo()) {
      return res.status(409).json({ error: 'Ya hay una sincronización en curso', corriendo: true });
    }

    if (!wait) {
      // 202 Accepted: arranca y sigue solo. Los errores quedan en SyncRun.
      sync
        .syncCatalogo({ limit, maxScreenshots, appids })
        .catch((err) => console.error('[sync] catálogo (bg) falló:', err.message));
      return res.status(202).json({
        ok: true,
        mensaje: `Catálogo en curso (hasta ${appids.length || limit} juegos). Mirá el avance con GET /steam-sync`,
        limit,
        maxScreenshots,
        appids: appids.length || undefined,
      });
    }

    const resultado = await sync.syncCatalogo({ limit, maxScreenshots, appids });
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return next(err);
  }
});

/** Refresca precio/descuento de los juegos ya importados. */
router.post('/offers', async (req, res, next) => {
  const body = req.body || {};
  const soloEnOferta = body.soloEnOferta === true || body.soloEnOferta === 'true';
  const wait = body.wait === true || body.wait === 'true';

  try {
    if (sync.estaCorriendo()) {
      return res.status(409).json({ error: 'Ya hay una sincronización en curso', corriendo: true });
    }

    if (!wait) {
      sync
        .syncOfertas({ soloEnOferta })
        .catch((err) => console.error('[sync] ofertas (bg) falló:', err.message));
      return res.status(202).json({ ok: true, mensaje: 'Ofertas en curso. Mirá el avance con GET /steam-sync', soloEnOferta });
    }

    const resultado = await sync.syncOfertas({ soloEnOferta });
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return next(err);
  }
});

/**
 * Re-etiqueta por nombre: busca en Steam los juegos del catálogo que no tienen
 * appid y les engancha géneros y plataformas. Útil después de una carga desde
 * otra fuente (RAWG) o de una importación manual.
 *
 *   POST /steam-sync/retag?tkn=MI_TOKEN   {"limit":50,"wait":true}
 *
 * Cada juego cuesta 1 request de búsqueda (+1 si hay coincidencia), así que va
 * en segundo plano salvo que pidas `wait:true`.
 */
router.post('/retag', async (req, res, next) => {
  const body = req.body || {};
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 300);
  const soloSinGenero = body.soloSinGenero === undefined ? true : body.soloSinGenero === true || body.soloSinGenero === 'true';
  const wait = body.wait === true || body.wait === 'true';

  try {
    if (sync.estaCorriendo()) {
      return res.status(409).json({ error: 'Ya hay una sincronización en curso', corriendo: true });
    }

    if (!wait) {
      sync
        .reEtiquetarPorNombre({ limit, soloSinGenero })
        .catch((err) => console.error('[sync] retag (bg) falló:', err.message));
      return res.status(202).json({
        ok: true,
        mensaje: `Re-etiquetando hasta ${limit} juegos. Mirá el avance con GET /steam-sync`,
        limit,
        soloSinGenero,
      });
    }

    const resultado = await sync.reEtiquetarPorNombre({ limit, soloSinGenero });
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;