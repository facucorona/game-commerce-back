const { Router } = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth2').Strategy;

const validateUserAuth = require('./helpers/loginGoogleHelper');

const jwt = require('jsonwebtoken');

const { SECRET_KEY, URL_ALLOWED, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, URL } = process.env;

const router = Router();

// FIX 3 — La estrategia de Google solo se registra si hay credenciales.
// Antes se registraba siempre y passport-oauth2 tira
// "OAuth2Strategy requires a clientID option" al arrancar. Como loginUser.js
// importa este archivo, el API NO LEVANTABA en desarrollo sin claves de Google
// configuradas (el login con email es el principal). Con este guarda, el resto
// de la app funciona y solo /auth/google queda desactivado.
const googleActivo = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

if (googleActivo) {
    passport.use("authGoogle", new GoogleStrategy(
        {
            clientID: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            callbackURL: URL + `login/auth/google/redirect`,
        },
        async (request, accessToken, refreshToken, profile, done) => {
            const user = await validateUserAuth(profile);
            return done(null, user);
        }
    ));
} else {
    console.warn('[authGoogle] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET sin definir: login con Google desactivado.');
}

// Si la estrategia no está registrada, `passport.authenticate('authGoogle')`
// revienta con «Unknown authentication strategy» y la ruta responde 500 con un
// error de Passport que no le dice nada a nadie. Con este middleware se
// responde 503 con un mensaje claro en su lugar.
function googleOauth(scope) {
    if (!googleActivo) {
        return (req, res) =>
            res.status(503).json({
                error: 'Login con Google desactivado: falta GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET en el .env',
            });
    }
    return passport.authenticate('authGoogle', scope);
}

router.get('/google/redirect',
    googleOauth({ session: false }),
    async (req, res) => {
        if (req.user && !req.user.isBanned) {
            const body = { id: req.user.id, email: req.user.email }
            const token = jwt.sign({ user: body }, SECRET_KEY, {
                expiresIn: '3h'
            })
            res.redirect(URL_ALLOWED+'/oauth2/'+token)
        } else {
            res.redirect(URL_ALLOWED+'/oauth2/')
        }
    }
);

router.get('/google', googleOauth({ scope: ['email', 'profile'] }));

router.get('/google/failure', (req, res) => {
    res.send('Failed to authenticate..');
});

module.exports = router;