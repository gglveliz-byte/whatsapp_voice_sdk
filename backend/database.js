// =========================================================================
// 🗄️ CAPA DE PERSISTENCIA (POSTGRESQL & JSON DUAL ENGINE) — WHATSAPP VOICE SDK
// =========================================================================
// Desarrollado con honor por Luis Damian Veliz, Socio Fundador Mayoritario y CTO de NEURO IA S.A.S.
// Este módulo unifica la persistencia de producción en PostgreSQL con un fallback local
// automático a archivo JSON. Incluye soporte nativo de SSL para Render y auto-migraciones en caliente.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_FILE = path.join(__dirname, 'database.json');

// Estructura por defecto
const DEFAULT_CONFIG = {
  metaAccessToken: '',
  phoneNumberId: '',
  wabaId: '',
  metaVerifyToken: 'whatsapp_voice_sdk_verify_token',
  geminiApiKey: '',
  iceServers: 'stun:stun.l.google.com:19302'
};

let pool = null;
let usePostgreSQL = false;

/**
 * Resuelve y conecta con la base de datos de PostgreSQL o activa el fallback JSON
 */
async function initDatabase() {
  const connectionString = process.env.DATABASE_URL;
  const hasPgConfig = connectionString || process.env.DB_HOST;

  if (!hasPgConfig) {
    console.log('[DB] No se configuró PostgreSQL en el .env. Usando persistencia local en database.json');
    initJsonFile();
    return;
  }

  try {
    console.log('[DB] Conectando a la Base de Datos de PostgreSQL...');
    
    // Configuración especial de SSL para servidores de producción como RENDER o AWS RDS
    const sslConfig = process.env.NODE_ENV === 'production' || (connectionString && connectionString.includes('render.com'))
      ? { rejectUnauthorized: false }
      : false;

    const poolConfig = connectionString 
      ? { connectionString, ssl: sslConfig }
      : {
          host: process.env.DB_HOST,
          port: parseInt(process.env.DB_PORT || '5432'),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          ssl: sslConfig
        };

    pool = new Pool(poolConfig);
    
    // Probar la conexión ejecutando un ping
    const client = await pool.connect();
    console.log('[DB] 🟢 Conexión establecida con éxito con PostgreSQL.');
    
    // MIGRACIÓN AUTOMÁTICA: Crea la tabla de configuración si no existe
    console.log('[DB] ⚡ Ejecutando migraciones automáticas en caliente...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS sdk_configurations (
        id INT PRIMARY KEY,
        phone_number_id VARCHAR(255) NOT NULL,
        waba_id VARCHAR(255),
        meta_access_token TEXT NOT NULL,
        meta_verify_token VARCHAR(255) NOT NULL,
        gemini_api_key TEXT NOT NULL,
        ice_servers VARCHAR(255) DEFAULT 'stun:stun.l.google.com:19302',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('[DB] 🚀 Migración finalizada: Tabla "sdk_configurations" lista.');
    client.release();
    usePostgreSQL = true;
  } catch (error) {
    console.error('[DB] ⚠️ No se pudo conectar a PostgreSQL:', error.message);
    console.log('[DB] 🔄 Activando modo de contingencia: Usando base de datos en database.json');
    usePostgreSQL = false;
    initJsonFile();
  }
}

/**
 * Asegura la existencia del archivo de base de datos local JSON (fallback)
 */
function initJsonFile() {
  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      console.log(`[DB] Base de datos JSON local creada en: ${DB_FILE}`);
    } catch (error) {
      console.error('[DB] Error al inicializar base de datos JSON local:', error.message);
    }
  }
}

/**
 * Recupera la configuración de forma asíncrona (Soporta Postgres y JSON)
 * @returns {Promise<Object>} Configuración recuperada
 */
async function getConfig() {
  if (usePostgreSQL) {
    try {
      const res = await pool.query('SELECT * FROM sdk_configurations WHERE id = 1 LIMIT 1');
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          phoneNumberId: row.phone_number_id,
          wabaId: row.waba_id,
          metaAccessToken: row.meta_access_token,
          metaVerifyToken: row.meta_verify_token,
          geminiApiKey: row.gemini_api_key,
          iceServers: row.ice_servers || 'stun:stun.l.google.com:19302'
        };
      }
    } catch (error) {
      console.error('[DB] Error al consultar configuración en PostgreSQL, usando fallback:', error.message);
    }
  }

  // Fallback a JSON Local
  initJsonFile();
  try {
    const rawData = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(rawData);
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Guarda las credenciales de forma persistente (Soporta Postgres y JSON)
 * @param {Object} newConfig Nuevos valores a almacenar
 * @returns {Promise<Boolean>} Éxito de la operación
 */
async function saveConfig(newConfig) {
  const current = await getConfig();
  
  const merged = {
    phoneNumberId: newConfig.phoneNumberId !== undefined ? newConfig.phoneNumberId.trim() : current.phoneNumberId,
    wabaId: newConfig.wabaId !== undefined ? newConfig.wabaId.trim() : current.wabaId,
    metaAccessToken: newConfig.metaAccessToken !== undefined ? newConfig.metaAccessToken.trim() : current.metaAccessToken,
    metaVerifyToken: newConfig.metaVerifyToken !== undefined ? newConfig.metaVerifyToken.trim() : current.metaVerifyToken,
    geminiApiKey: newConfig.geminiApiKey !== undefined ? newConfig.geminiApiKey.trim() : current.geminiApiKey,
    iceServers: newConfig.iceServers !== undefined ? newConfig.iceServers.trim() : current.iceServers
  };

  if (usePostgreSQL) {
    try {
      // UPSERT en PostgreSQL: Inserta si no existe id=1, de lo contrario actualiza los valores
      await pool.query(`
        INSERT INTO sdk_configurations (id, phone_number_id, waba_id, meta_access_token, meta_verify_token, gemini_api_key, ice_servers, updated_at)
        VALUES (1, $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (id)
        DO UPDATE SET
          phone_number_id = EXCLUDED.phone_number_id,
          waba_id = EXCLUDED.waba_id,
          meta_access_token = EXCLUDED.meta_access_token,
          meta_verify_token = EXCLUDED.meta_verify_token,
          gemini_api_key = EXCLUDED.gemini_api_key,
          ice_servers = EXCLUDED.ice_servers,
          updated_at = CURRENT_TIMESTAMP
      `, [
        merged.phoneNumberId,
        merged.wabaId,
        merged.metaAccessToken,
        merged.metaVerifyToken,
        merged.geminiApiKey,
        merged.iceServers
      ]);
      console.log('[DB] Configuración guardada y replicada en PostgreSQL con éxito.');
      return true;
    } catch (error) {
      console.error('[DB] Error al guardar configuración en PostgreSQL:', error.message);
    }
  }

  // Guardar en JSON (Fallback o Local principal)
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    console.log('[DB] Configuración guardada correctamente en database.json');
    return true;
  } catch (error) {
    console.error('[DB] Error al escribir en database.json:', error.message);
    return false;
  }
}

module.exports = {
  initDatabase,
  getConfig,
  saveConfig
};
