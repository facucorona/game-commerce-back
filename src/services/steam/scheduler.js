/**
 * SCHEDULER del sincronizador de Steam
 * ----------------------------------------------------------------------------
 * No usamos `node-cron` a propósito: este proyecto no necesita una dependencia
 * nueva para tener un tablero. Armamos una cadena de `setTimeout` que se
 * reprograma sola al terminar cada tarea (en vez de `setInterval`), con dos
 * ventajas:
 *   - no se acumulan tareas si una corrida se pasa de tiempo,
 *   - la deriva (el reloj siempre se atrasa un poco) se corrige en cada vuelta.
 *
 * Frecuencias (ambos valores se pueden pisar por .env):
 *   - ofertas  → cada 12 h   (los descuentos de Steam duran horas/días)
 *   - catálogo → 1 vez por día (entran novedades)
 *   - full     → 1 vez por semana (recorre todo, incluidas las capturas)
 *
 * Arranca SOLO si STEAM_SYNC_ENABLED=true, para que en desarrollo no quede
 * golpeando Steam sin que lo pidas explícitamente.
 */

const sync = require('./syncService');

// "12h", "1d", "1w" → milisegundos
function aMs(valor, porDefecto) {
  const v = String(valor || porDefecto).trim().toLowerCase();
  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  const unidad = v.slice(-1);
  if (unidad === 'w') return n * 7 * 24 * 60 * 60 * 1000;
  if (unidad === 'd') return n * 24 * 60 * 60 * 1000;
  if (unidad === 'h') return n * 60 * 60 * 1000;
  if (unidad === 'm') return n * 60 * 1000;
  return n * 1000;
}

// Retraso inicial: deja pasar unos segundos desde el arranque del server.
const RETRASO_INICIAL_MS = Number(process.env.STEAM_SYNC_INITIAL_DELAY_MS || 15000);

let timers = [];

function programar(nombre, cadaMs, tarea) {
  async function correr() {
    try {
      console.log(`[sync:${nombre}] arrancando (cada ${Math.round(cadaMs / 3600000)}h)`);
      await tarea();
    } catch (err) {
      // Una falla no debe matar el scheduler: se loguea y se sigue.
      console.error(`[sync:${nombre}] falló: ${err.message}`);
    }
  }

  // Primer disparo + reprogramación encadenada.
  timers.push(setTimeout(async () => {
    await correr();
    timers.push(setTimeout(() => ciclo(), cadaMs));
  }, RETRASO_INICIAL_MS));

  function ciclo() {
    timers.push(setTimeout(async () => {
      await correr();
      ciclo();
    }, cadaMs));
  }
}

/** Arranca el tablero. Devuelve un `stop()` para apagarlo (tests, shutdown). */
function start() {
  if (process.env.STEAM_SYNC_ENABLED !== 'true') {
    console.log('[sync] scheduler apagado (STEAM_SYNC_ENABLED != true)');
    return { stop: () => {} };
  }

  const OFERTAS_MS = aMs(process.env.STEAM_OFFERS_EVERY, '12h');
  const CATALOGO_MS = aMs(process.env.STEAM_CATALOG_EVERY, '1d');
  const FULL_MS = aMs(process.env.STEAM_FULL_EVERY, '1w');

  programar('ofertas', OFERTAS_MS, () => sync.syncOfertas({}));
  programar('catalogo', CATALOGO_MS, () =>
    sync.syncCatalogo({ limit: Number(process.env.STEAM_CATALOG_LIMIT || 200) })
  );
  // El full es como el catálogo pero más exhaustivo: además refresca capturas.
  programar('full', FULL_MS, () =>
    sync.syncCatalogo({
      limit: Number(process.env.STEAM_CATALOG_LIMIT || 200),
      maxScreenshots: Number(process.env.STEAM_MAX_SCREENSHOTS || 5),
    })
  );

  console.log(
    `[sync] scheduler ON · ofertas=${process.env.STEAM_OFFERS_EVERY || '12h'} ` +
      `catálogo=${process.env.STEAM_CATALOG_EVERY || '1d'} full=${process.env.STEAM_FULL_EVERY || '1w'}`
  );

  return { stop: () => timers.forEach(clearTimeout) };
}

module.exports = { start, aMs };