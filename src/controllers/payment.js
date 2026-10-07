const { Router } = require('express');
const router = Router();
const mercadopago = require("mercadopago");
const { ACCESS_TOKEN } = process.env;

// FIX 4 — MercadoPago solo se configura si hay ACCESS_TOKEN.
// El SDK tira "You must provide a method of authentication" al hacer configure(),
// y como routes/index.js importa este controlador, el API no levantaba sin el
// token de MercadoPago en el .env. Con el guarda, el resto de la app funciona y
// el checkout queda desactivado con un mensaje claro en vez de tumbar todo.
let mercadopagoActivo = true;
if (ACCESS_TOKEN) {
  mercadopago.configure({
    access_token: ACCESS_TOKEN,
  });
} else {
  mercadopagoActivo = false;
  console.warn('[payment] ACCESS_TOKEN (MercadoPago) sin definir: checkout desactivado.');
}

// let preference = {
//     items: [
//       {
//         title: "Mi producto",
//         unit_price: 100,
//         quantity: 1,
//       },
//     ]
//   };
  
  
  
  router.post('/', function(req, res, next) {
    /* aquí crea tu orden en la DB para el usuario logeado */
  //const order = db.orders.create({ userId: req.userId, productId: req.body.productId }); // <--- pseudo-código
    let preference = req.body;

    // Sin ACCESS_TOKEN no hay checkout posible: se responde 503 en vez de
    // reventar con una excepción del SDK.
    if (!mercadopagoActivo) {
      return res.status(503).json({ error: 'Checkout deshabilitado: falta ACCESS_TOKEN de MercadoPago en el .env del API' });
    }

    mercadopago.preferences
    .create(preference)
    .then(function (response) {
        console.log(response)
    // En esta instancia deberás asignar el valor dentro de response.body.id por el ID de preferencia solicitado en el siguiente paso
    res.json({ preferenceId: response.body.id })
    })
    .catch(function (error) {
    console.log(error);
    });
  });

module.exports = router;