/*
 * SEED DE USUARIOS DE MUESTRA
 * ----------------------------------------------------------------------------
 * Crea los usuarios de demostración en cualquier ambiente (local o Neon).
 * Idempotente: se puede correr las veces que haga falta sin duplicar, porque
 * busca por email antes de crear.
 *
 * Uso:
 *   npm run db:seed-users
 *
 * Para que corra contra Neon en vez del Postgres local, superponer .env.neon:
 *   node -e "require('dotenv').config({path:'.env.neon',override:true});require('./scripts/seedUsers.js')"
 *
 * Las contraseñas se hashean con bcryptjs (mismo formato $2b$ que usaba bcrypt
 * nativo, así que conviven sin problema).
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const USUARIOS = [
  {
    username: 'adminx',
    name: 'Admin',
    lastname: 'Demo',
    email: 'admin@admin.com',
    password: 'Admin123!',
    isAdmin: true,
    isVerified: true,
    profile_pic: 'https://play.nintendo.com/images/profile-mk-yoshi.babe07bc.png',
  },
  {
    username: 'shopper1',
    name: 'Shopper',
    lastname: 'Demo',
    email: 'shopper@shopper.com',
    password: 'Shopper123!',
    isAdmin: false,
    isVerified: true,
    profile_pic: 'https://play.nintendo.com/images/profile-mk-toad.7df41cfd.png',
  },
  {
    username: 'facucorona',
    name: 'Facundo',
    lastname: 'Corona',
    email: 'asdeer@yopmail.com',
    password: 'Shopper123!',
    isAdmin: false,
    isVerified: true,
    profile_pic: 'https://play.nintendo.com/images/profile-mk-donkeykong.03c4b02c.png',
  },
];

(async () => {
  try {
    const { Users } = db;
    for (const u of USUARIOS) {
      const existe = await Users.findOne({ where: { email: u.email } });
      if (existe) {
        console.log(`[seed] ${u.email}: ya existe (no se toca)`);
        continue;
      }
      await Users.create({
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        email: u.email,
        password: bcrypt.hashSync(u.password, 10),
        profile_pic: u.profile_pic,
        isAdmin: u.isAdmin,
        isVerified: u.isVerified,
        isBanned: false,
      });
      console.log(`[seed] ${u.email}: creado`);
    }
    console.log('[seed] listo');
    process.exit(0);
  } catch (err) {
    console.error('[seed] falló:', err.message);
    process.exit(1);
  }
})();