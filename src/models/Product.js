const { DataTypes } = require('sequelize');
// Exportamos una funcion que define el modelo
// Luego le injectamos la conexion a sequelize.
module.exports = (sequelize) => {
  // defino el modelo
  sequelize.define('Products', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    id_api: {
      type: DataTypes.INTEGER,    
      
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },  
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
    },  
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    rating: {
      type: DataTypes.FLOAT,
      defaultValue: 0,      
    },    
    metacriticRating: {
      type: DataTypes.FLOAT,
      defaultValue: 0,      
    },    
    esrb_rating: {
       type: DataTypes.STRING,
       defaultValue: "Rating Pending"
    },
    background_image: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    released: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // trailer: {
    //   type: DataTypes.STRING,      
    // },
    requeriments_recomended: {
      type: DataTypes.STRING, 
      defaultValue: "Has no Requeriments"     
    },
    requeriments_min: {
      type: DataTypes.STRING,      
      defaultValue: "Has no Requeriments"     
    }, 
    price: {
      type: DataTypes.FLOAT,      
    }, 
    isDisabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,      
    },
    onSale: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    /* ------------------------------------------------------------------
     * Datos de Steam (agregados para el sincronizador).
     * `steam_appid` es la clave externa: permite reimportar un juego sin
     * duplicarlo. Unique + NULL_multiple = varios NULL conviven sin problema,
     * así que los juegos cargados desde RAWG/manual quedan intactos.
     * OJO: `price` sigue siendo TU precio de venta; el de Steam es referencia.
     * ---------------------------------------------------------------- */
    steam_appid: {
      type: DataTypes.BIGINT,
      allowNull: true,
      unique: true,
    },
    steam_price_currency: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    steam_price_original: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    steam_price_final: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    steam_discount_percent: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    steam_price_expires: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    developers: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    publishers: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isFree: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // 'steam' | 'rawg' | 'manual' → de dónde vino cada juego
    source: {
      type: DataTypes.STRING,
      defaultValue: 'manual',
    },
    // Última vez que el sincronizador tocó este registro
    last_synced_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // createdDb: {
    //   type: DataTypes.BOOLEAN,
    //   defaultValue: false,      
    // },    
  },{timestamps: false});
};


// id
// // name
// description
// rating
// backgroun_image
// released
// screenshots
// trailer
// req.recomended
// prices
// req min

// isDisabled
// onSale
// esrb_rating
// genre_id
// esrb_rating_id