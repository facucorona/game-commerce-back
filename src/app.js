const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const passport = require('passport')
const session = require('express-session');
const cors = require('cors')
const engines = require("consolidate");

require('./db.js');

const server = express();

const routes = require('./routes/index.js');

server.name = 'API';


const { KEY_SECRET, URL_ALLOWED } = process.env;


server.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
server.use(bodyParser.json({ limit: '50mb' }));
server.use(cookieParser(KEY_SECRET));
server.use(morgan('dev'));
server.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Credentials', 'true'),
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');

  next();
});
server.use(session({
  secret: KEY_SECRET,
  resave: false,
  saveUninitialized: false,
}));
server.use(passport.initialize());
server.use(passport.session());

/*
 * FIX 1 — Guard JWT con rutas públicas y bypass del preflight CORS.
 *
 * Antes: `server.use(passport.authenticate(KEY_SECRET))` exigía token a TODAS las
 * rutas, y el fallo era doble:
 *   a) El catálogo (GET /videogames/) y las reseñas devolvían 401 sin sesión,
 *      con lo cual la tienda se veía VACÍA para quien no estuviera logueado.
 *   b) El preflight CORS (OPTIONS) también moría en el guard, y como el browser
 *      manda OPTIONS antes de cada llamada con cabecera, el front ni siquiera
 *      llegaba a consultar la ruta real.
 *
 * Ahora: se deja pasar OPTIONS (nunca lleva token) y las rutas públicas
 * (catálogo, reseñas y búsqueda de usuario en el registro). El resto sigue
 * exigiendo JWT, que el front manda en la query: ?tkn=<token>.
 *
 * OJO: la estrategia se llama 'jwt' y está registrada en
 * controllers/loginUser.js. Antes se pasaba KEY_SECRET como nombre de estrategia
 * y, como no existe ninguna con ese nombre, Passport cortaba TODAS las peticiones.
 *
 * Rutas públicas (motivo de cada una):
 *   /videogames  → catálogo: sin esto la tienda se ve VACÍA sin sesión
 *   /genres      → filtros del catálogo (mismo motivo)
 *   /platforms   → filtros del catálogo (mismo motivo)
 *   /reviews     → reseñas públicas de la ficha de producto
 *   /user/find   → validación del formulario de registro (email/username)
 *   /login       → acá se EMITE el token: si exigiera token no habría login
 *   /logout      → cierre de sesión
 *   /signin      → alta de usuario
 *   /restore     → "olvidé mi contraseña" (el token viaja en la URL del mail)
 */
const PUBLIC_ROUTES = [
  /^\/videogames/,
  /^\/genres/,
  /^\/platforms/,
  /^\/reviews/,
  /^\/user\/find/,
  /^\/login/,
  /^\/logout/,
  /^\/signin/,
  /^\/restore/,
];
server.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (PUBLIC_ROUTES.some((re) => re.test(req.path))) return next();
  return passport.authenticate('jwt', { session: false })(req, res, next);
});

server.use('/', routes);
server.engine("ejs", engines.ejs);
server.set("views", "./views");
server.set("view engine", "ejs");

// Error catching endware.// 
server.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const message = err.message || err;
  console.error(err);
  res.status(status).send(message);
});

module.exports = server;
