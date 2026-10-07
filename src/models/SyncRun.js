const { DataTypes } = require('sequelize');

/**
 * SYNC_RUNS — bitácora de las sincronizaciones.
 *
 * Cada corrida (catálogo u ofertas) deja una fila con cuándo arrancó y terminó,
 * cuántos juegos se crearon/actualizaron y cuántos errores hubo. Sirve para:
 *  - mostrar el estado del sync en el panel admin,
 *  - detectar que algo se rompió (dos corridas seguidas fallidas),
 *  - no superponer corridas.
 */
module.exports = (sequelize) => {
  sequelize.define(
    'SyncRun',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // 'catalog' | 'offers'
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // 'running' | 'ok' | 'error'
      status: {
        type: DataTypes.STRING,
        defaultValue: 'running',
      },
      started_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      finished_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      updated_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      skipped_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      error_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      // Errores (recortados) y parámetros usados, en JSON
      detail: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    { timestamps: false }
  );
};
