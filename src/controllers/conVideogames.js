const Router = require('express');
const router = Router();
const { Products, Platforms, Genre, Screenshots, UsedPlatforms, UsedGenre, steamSync } = require('../db');
const {Op} = require('sequelize');
// (axios se usaba solo en el endpoint muerto GET /add_api, que pegaba a RAWG:
// se eliminó junto con él. Si algún endpoint futuro necesita HTTP saliente,
// el cliente con rate limit vive en services/steam/client.js.)


router.get("/", async (req, res)=>{
    try{
        let nameQuery = req.query.name;
        if (nameQuery) {
            let slug = nameQuery.split(' ').join('-').toLowerCase();

            // Busca en la base local (ya sincronizada con Steam)
            const fetchDbName = await Products.findAll({
                where: {
                    [Op.or]: [
                        { name: { [Op.iLike]: '%' + nameQuery + '%' } },
                        { slug: { [Op.like]: '%' + slug + '%' } }
                    ]
                },
                include:[{model: Genre, attributes: ['name'], through: { attributes: [] }},
                        {model: Platforms, attributes: ['name'], through: { attributes: [] }},
                        {model: Screenshots, attributes: ['image'], through: { attributes: [] }}
                    ]
            });

            res.status(200).send(fetchDbName);

        }else{
            // TRIGGER POR VISITA (reemplaza al scheduler en serverless): si el
            // catálogo lleva +24 h u ofertas +6 h sin refrescarse, lanza un sync
            // incremental EN SEGUNDO PLANO. No se espera: la respuesta sale con
            // lo que hay en la base y el sync escribe para la próxima visita.
            // Solo en esta rama (carga de home), no en las búsquedas con ?name=.
            // Ventanas y topes por env (ver README del API).
            steamSync.syncAlEntrar({
                minHorasCatalogo: Number(process.env.SYNC_CATALOG_HOURS || 24),
                minHorasOfertas: Number(process.env.SYNC_OFFERS_HOURS || 6),
                topeCatalogo: Number(process.env.SYNC_TOP_CATALOG || 6),
                topeOfertas: Number(process.env.SYNC_TOP_OFFERS || 12),
            }).catch(() => {});
            var dbAll = await Products.findAll({
                include:[{model: Genre, attributes: ['name'], through: { attributes: [] }},
                        {model: Platforms, attributes: ['name'], through: { attributes: [] }}]
            });
            res.status(200).send(dbAll)
        }    
    }catch(err){
        console.log(err);
        res.status(401).send(err);
    }
})

router.get("/:id", async (req, res)=>{
    try{
        // Ficha por id UUID de Products. Antes había una rama que buscaba por
        // `id_api` (id numérico de RAWG) cuando el id era numérico; se eliminó
        // con el resto del código muerto de RAWG: ningún juego de Steam tiene
        // id_api y esa rama siempre devolvía 404.
        let {id} = req.params
        // Guarda: Postgres tira error si se busca un UUID con texto que no es
        // UUID ("invalid input syntax"), y el catch lo convertía en un 401
        // confuso. Lo que no parece UUID es 404 directo.
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(404).send('Product does not exist');
        }
        var details = await Products.findOne({
            where: { id: id },
            include:[{model: Genre, attributes: ['name'], through: { attributes: [] }},
                    {model: Platforms, attributes: ['name'], through: { attributes: [] }},
                    {model: Screenshots, attributes: ['image'], through: { attributes: [] }}]
        });
        if (!details) {
            res.status(404).send(details);
        }else{
            res.status(200).send(details);
        }
    }catch(err){
        console.log(err);
        res.status(401).send(err);
    }
})

//el primer key/value del objeto req.body DEBE SER id:xxxxxxxxxxxx
router.put('/edit', async(req, res, next)=>{
    try {      
        let edit = req.body
        let id= req.body.id

        let keys = Object.keys(edit)
        keys.shift()

        let values = Object.values(edit)
        values.shift() 
        
        keys.map(async(k, i)=>{await Products.update({
            [k]: values[i],
        }, {
            where: {
                id: [id],
            }})
        });
        
        let product = await Products.findOne({ where: { id: id } });

        if (edit.addGenre) {
            edit.addGenre.forEach(async (e) => {
                let genre = await Genre.findOne({ where: { name:  e} });
                await product.addGenre(genre)
            });
        }
        if (edit.rmvGenre) {
            edit.rmvGenre.forEach(async (e) => {
                let genre = await Genre.findOne({ where: { name:  e} });
                await product.removeGenre(genre)
            });
        }
        if (edit.addPlat) {
            edit.addPlat.forEach(async (e) => {
                let plat = await Platforms.findOne({ where: { name:  e} });
                await product.addPlatforms(plat)
            });
        }
        if (edit.rmvPlat) {
            edit.rmvPlat.forEach(async (e) => {
                let plat = await Platforms.findOne({ where: { name:  e} });
                await product.removePlatforms(plat)
            });
        }
        
        
        res.status(200).send("Juego editado!")
    } catch (err) {
        next(err)
    }
}) 

//let product_required = name && description && genre && rating && metacriticRating && esrb_rating && background_image && released && requeriments_min && requeriments_recomended && price && onSale && isDisabled
router.post("/create", async (req,res)=>{
    const {name, genres, description, rating, metacriticRating, esrb_rating, 
        background_image, released, requeriments_min, requeriments_recomended,
        price, onSale, platforms, isDisabled, screenshots} = req.body;
        console.log("🚀 ~ file: conVideogames.js ~ line 168 ~ router.post ~ Screenshots", screenshots)
        
    if( name && description && genres && platforms && background_image &&
        released && price){
        try{
            let slug = name.split(' ').join('-').toLowerCase();
            let Create_Videogame = await Products.create({
                name, slug, description, rating, platforms, metacriticRating, esrb_rating,
                background_image, released, requeriments_min, requeriments_recomended,
                price, onSale, isDisabled
            });

            await screenshots.forEach(async (e) => {
                console.log("🚀 ~ file: conVideogames.js ~ line 183 ~ awaitscreenshots.forEach ~ e", e)
                let screenDb = await Screenshots.create({                    
                    image: e
                });
                await Create_Videogame.addScreenshots(screenDb);
                console.log("🚀 ~ file: conVideogames.js ~ line 189 ~ awaitscreenshots.forEach ~ screenDb", screenDb)
            })
            
            // await screenshots.forEach(async (e) => {
            //     var screenDb = await Screenshots.findAll({ where: { image: e }});
            // });

            const findGenre = await Genre.findAll({
                where:{name: genres}
            });
            const findPlatforms = await Platforms.findAll({
                where:{name: platforms}
            });
            Create_Videogame.addGenre(findGenre);
            Create_Videogame.addPlatforms(findPlatforms);


            platforms.map(async (e) => {
                let find = await UsedPlatforms.findOrCreate({
                    where: { name: e },
                });
            })
            
            genres.map(async (e) => {
                let find2 = await UsedGenre.findOrCreate({
                    where: { name: e },
                });
            })
            
            
            res.status(200).send("Videogame Succesfully Created!")
        }catch(e){
            console.error(e);
            res.status(401).send(e);
        };
    }else{
        res.status(401).send("Error. Complete the missing fields!.")
    };
});

module.exports = router;