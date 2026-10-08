import { defineConfig } from "@neon/config/v1";

/*
 * neon.ts — config de infraestructura Neon (rama `production`).
 * ----------------------------------------------------------------------------
 * Vacío a propósito, y esa es la decisión correcta para este proyecto:
 *
 *  - Sin `auth`: la app YA tiene su propio login (Passport JWT con `?tkn=`).
 *    Activar Neon Auth agregaría un segundo sistema de identidad sin que nadie
 *    lo use. Si algún día se migra el login, acá va `auth: true`.
 *
 *  - Sin `dataApi`: es un toggle de compatibilidad para clientes PostgREST o
 *    `supabase-js`. El front habla HTTP con Express (`REACT_APP_URL`), así que
 *    no aplica y solo sumaría una superficie expuesta de más.
 *
 *  - Sin `functions` / `buckets` / `aiGateway`: este proyecto no los usa. El
 *    backend vive en Vercel y los assets en el CDN de Vercel.
 *
 *  - Sin política de `branch`: no se crean ramas de desarrollo. Si algún día se
 *    quiere probar contra una copia aislada (`neon checkout dev --create`),
 *    acá va el bloque `branch` con ttl + scale-to-zero.
 *
 * El esquema de la base NO se declara acá: lo crea Sequelize con
 * `npm run db:migrate` (conn.sync + migraciones 001/002 + semilla de Steam).
 */
export default defineConfig({});
