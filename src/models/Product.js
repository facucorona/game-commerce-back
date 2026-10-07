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
    // ── Rating oficial de Steam (migración 002) ────────────────────────────────
    // Steam publica el puntaje de sus propios usuarios sin API key ni 2FA en
    // /appreviews/<appid>?json=1. Va en columnas PROPIAS a propósito: el campo
    // `rating` de arriba quedó en escala 0-100 por herencia de RAWG (y en 0 para
    // lo importado de Steam, porque no había fuente), así que el catálogo lee
    // estas columnas y `rating` queda solo para el panel admin.
    //   steam_rating_score    → review_score de Steam, 0-10 (null = sin reseñas)
    //   steam_rating_desc     → veredicto textual ("Very Positive", "Mixed"…)
    //   steam_rating_reviews  → cuántas reseñas hay atrás del score
    steam_rating_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    steam_rating_desc: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    steam_rating_reviews: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
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