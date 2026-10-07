require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');
const getApiGames = require('./services/getApiGames');
const getApiPlatforms = require('./services/getApiPlatforms');
const getApiGenres = require('./services/getApiGenres');
// Sincronizador de Steam: reemplaza a RAWG como fuente del catálogo.
const steamSync = require('./services/steam/syncService');
const {
  DB_USER, DB_PASSWORD, DB_HOST, DB_NAME
} = process.env;


let sequelize =
  process.env.NODE_ENV === "production"
    ? new Sequelize({
        database: DB_NAME,
        dialect: "postgres",
        host: DB_HOST,
        port: 5432,
        username: DB_USER,
        password: DB_PASSWORD,
        pool: {
          max: 3,
          min: 1,
          idle: 10000,
        },
        dialectOptions: {
          ssl: {
            require: true,
            // Ref.: https://github.com/brianc/node-postgres/issues/2009
            rejectUnauthorized: false,
          },
          keepAlive: true,
        },
        ssl: true,
      })
    : new Sequelize(
        `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/videogames`,
        { logging: false, native: false }
      );
      
/*const sequelize = new Sequelize(`postgres://${DB_USER}:${DB_PASSWORD}@localhost/videogames`, {
  logging: false, // set to console.log to see the raw SQL queries
  native: false, // lets Sequelize know we can use pg-native for ~30% more speed
});*/
const basename = path.basename(__filename);

const modelDefiners = [];

fs.readdirSync(path.join(__dirname, '/models'))
  .filter((file) => (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js'))
  .forEach((file) => {
    modelDefiners.push(require(path.join(__dirname, '/models', file)));
  });

modelDefiners.forEach(model => model(sequelize));

let entries = Object.entries(sequelize.models);
let capsEntries = entries.map((entry) => [entry[0][0].toUpperCase() + entry[0].slice(1), entry[1]]);
sequelize.models = Object.fromEntries(capsEntries);

const { Products, Users, Reviews, Platforms, Genre, Screenshots, AuthUsers, UsedGenre , UsedPlatforms } = sequelize.models;

Products.belongsToMany(Users, { through: "wishList", timestamps: false})
Users.belongsToMany(Products, { through: "wishList", timestamps: false })

Products.belongsToMany(AuthUsers, { through: "Favorites", timestamps: false})
AuthUsers.belongsToMany(Products, { through: "Favorites", timestamps: false })

Products.belongsToMany(Users, { through: "Order"})
Users.belongsToMany(Products, { through: "Order"})

Products.belongsToMany(AuthUsers, { through: "order"})
AuthUsers.belongsToMany(Products, { through: "order"})

Products.belongsToMany(Platforms, { through: "PlatformGame", timestamps:false})
Platforms.belongsToMany(Products, { through: "PlatformGame", timestamps:false})

Genre.belongsToMany(Products, { through: "ProductGenre", timestamps:false})
Products.belongsToMany(Genre, { through: "ProductGenre", timestamps:false})

Screenshots.belongsToMany(Products, { through: "ProductScreenshot", timestamps:false})
Products.belongsToMany(Screenshots, { through: "ProductScreenshot", timestamps:false})

console.log('Relations created')

/*
 * SEMILLA DEL CATÁLOGO
 * ------------------------------------------------------------------
 * Antes: si la tabla estaba vacía, se seeded con RAWG (services/getApiGames).
 * Hoy RAWG no sirve sin API key, así que la fuente pasa a ser Steam.
 *
 * Se elige con DB_SEED:
 *   'steam' → importa desde Steam (sin key, con precios reales por región)
 *   'rawg'  → comportamiento anterior (necesita API_KEY)
 *   'none'  → no siembra nada (útil si vas a cargar todo a mano)
 *
 * Si no se define DB_SEED, se decide solo: con API_KEY se mantiene RAWG; sin
 * API_KEY (el caso actual) se usa Steam. El bloque corre igual dentro del
 * try/catch, así que una fuente caída no impide levantar el server.
 */
const DB_SEED = process.env.DB_SEED || (process.env.API_KEY ? 'rawg' : 'steam');

/*
 * NOTA DE ARRANQUE
 * Antes esta semilla se disparaba sola con un `setTimeout` al importar el módulo,
 * y eso era una bomba de tiempo: el timer corría a los 2 s mientras `conn.sync()`
 * (que recién crea las tablas) seguía trabajando, así que `Products.findAll()`
 * pegaba contra una tabla inexistente o con columnas viejas y mataba el proceso
 * con una promesa rechazada sin manejar. Ahora la expone `semillaSiEstaVacia()` y
 * la llama index.js DESPUÉS del sync y de la migración.
 */
async function semillaSiEstaVacia() {
  let productos;
  try {
    productos = await Products.findAll();
  } catch (err) {
    console.log('No se pudo leer Products para decidir la semilla:', err.message);
    return;
  }

  if (productos.length !== 0) {
    console.log('Games already loaded ');
    return;
  }

  console.log('La tabla de productos está vacía: arrancando la semilla…');

  try {
    if (DB_SEED === 'none') {
      console.log('DB_SEED=none: la tabla de productos queda vacía a propósito');
      return;
    }

    if (DB_SEED === 'steam') {
      console.log(`Cargando catálogo inicial desde Steam (${Number(process.env.STEAM_CATALOG_LIMIT || 200)} juegos)...`);
      // Steam ya trae plataformas y géneros en el detalle de cada juego, así que
      // no hacen falta los servicios sueltos de RAWG: sólo el catálogo.
      await steamSync.syncCatalogo({
        limit: Number(process.env.STEAM_CATALOG_LIMIT || 200),
        maxScreenshots: Number(process.env.STEAM_MAX_SCREENSHOTS || 5),
      });
      return;
    }

    await getApiPlatforms(Platforms);
    await getApiGenres(Genre);
    await getApiGames(Products, Platforms, Genre, Screenshots, UsedGenre, UsedPlatforms);
  } catch (err) {
    console.log(err);
    console.log('error on load db');
  }
}


module.exports = {
  ...sequelize.models,
  conn: sequelize,
  semillaSiEstaVacia,
  // El servicio de sync recibe los modelos ya associations-ados.
  steamSync,
};

// Inyección de dependencias: el servicio de Steam no hace `require('../db')`
// para no generar un require circular. Acá se le pasan los modelos ya definidos.
steamSync.setDB(module.exports);
