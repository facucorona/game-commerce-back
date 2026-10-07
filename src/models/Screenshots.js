const { DataTypes } = require('sequelize');
module.exports = (sequelize) => {
    sequelize.define('Screenshots', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        },
    image:{
        type:DataTypes.STRING,
        defaultValue:"No Image avaiable"
    },
    // Agregados por el sincronizador de Steam:
    // `position` mantiene el orden de las capturas y `hash` permite saver
    // si la imagen cambió (y volver a descargarla) sin comparar todo el set.
    position: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    hash: {
        type: DataTypes.STRING,
        allowNull: true,
    }
    })
};