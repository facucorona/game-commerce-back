const { Router } = require('express');
const passport = require('passport');
// bcryptjs (JS puro) en vez de bcrypt (nativo). Ver la nota en createUser.js:
// mismo formato de hash, pero sin node-gyp — que en Vercel no compila.
const bcrypt = require('bcryptjs')
const LocalStrategy = require('passport-local').Strategy;

const JWTStrategy = require('passport-jwt').Strategy
const ExtractJWT = require('passport-jwt').ExtractJwt
const jwt = require('jsonwebtoken')

const { Users } = require('../db');

const loginGoogle = require('./loginGoogle');
const main = require ("./helpers/sendEmail")

const router = Router();


const { SECRET_KEY } = process.env

router.use('/auth', loginGoogle);


passport.use('login', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password',
}, async (email, password, done) => {
    try {
        const user = await Users.findOne({ where: { email } });
        if (user && !user.isBanned) {
            let passwordMatch = await bcrypt.compare(password, user.password)
            if (email === user.email && passwordMatch) {
                return done(null, user);
            }
        }
        return done(null, false);
    } catch (e) {
        return done(e)
    }
}))

// FIX 2 — La estrategia se registra CON nombre 'jwt'.
// Antes era `passport.use(new JWTStrategy(...))` (anónima), pero el resto del
// proyecto la pide por nombre: el guard global pasaba KEY_SECRET como nombre de
// estrategia, y las rutas privadas usan passport.authenticate('jwt').
// Sin nombre registrado, ninguna de las dos invocaciones encontraba la
// estrategia y Passport respondía "Unknown authentication strategy".
passport.use('jwt', new JWTStrategy({
    secretOrKey: SECRET_KEY,
    jwtFromRequest: ExtractJWT.fromUrlQueryParameter('tkn')
}, async (token, done) => {
    try {
        return done(null, token.user)
    } catch (e) {
        // FIX: antes decía `done(error)`. `error` no existe en este scope, así que
        // el catch reventaba con ReferenceError y Passport terminaba la petición
        // sin responder (el front se quedaba colgado esperando el token).
        done(e)
    }
}))

router.post('/', async (req, res, next) => {
    passport.authenticate('login', async (err, user, info) => {
        try {
            if (err || !user) {
                return res.redirect('/login')
            }
            req.login(user, { session: false }, async (err) => {
                if (err) return next(err)
                const body = { id: user.id, email: user.email }
                const token = jwt.sign({ user: body }, SECRET_KEY, { expiresIn: '3h' })
                res.json({ token })
            })
        }
        catch (e) {
            return next(e)
        }
    })(req, res, next)
})

router.get('/', (req, res) => {
    res.json({ "message": 'send post to login' })
}); 

module.exports = router;
