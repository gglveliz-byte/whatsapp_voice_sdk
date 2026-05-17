// =========================================================================
// 🗄️ CAPA DE PERSISTENCIA (BASE DE DATOS) — WHATSAPP VOICE SDK
// =========================================================================
// Desarrollado con honor por Luis Damian Veliz, Socio Fundador Mayoritario y CTO.
// Este módulo lee y guarda de forma persistente las credenciales del desarrollador
// en un archivo 'database.json'. Es ligero, 100% portátil, rápido de desplegar
// en VPS y libre de dependencias nativas complejas propensas a errores.

const fs = require('fs');
const path = require('path');

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

/**
 * Inicializa la base de datos asegurando la existencia del archivo
 */
function init() {
  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      console.log(`[DB] Base de datos persistente inicializada en: ${DB_FILE}`);
    } catch (error) {
      console.error('[DB] Error al inicializar el archivo de base de datos:', error.message);
    }
  }
}

/**
 * Recupera la configuración persistida actual de la base de datos
 * @returns {Object} Configuración actual
 */
function getConfig() {
  init();
  try {
    const rawData = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error('[DB] Error al leer la base de datos, usando valores por defecto:', error.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Guarda las credenciales de forma persistente en la base de datos
 * @param {Object} newConfig Nuevos valores a almacenar
 * @returns {Boolean} Éxito de la operación
 */
function saveConfig(newConfig) {
  init();
  try {
    const current = getConfig();
    
    // Mezclamos y limpiamos valores vacíos
    const merged = {
      metaAccessToken: newConfig.metaAccessToken !== undefined ? newConfig.metaAccessToken.trim() : current.metaAccessToken,
      phoneNumberId: newConfig.phoneNumberId !== undefined ? newConfig.phoneNumberId.trim() : current.phoneNumberId,
      wabaId: newConfig.wabaId !== undefined ? newConfig.wabaId.trim() : current.wabaId,
      metaVerifyToken: newConfig.metaVerifyToken !== undefined ? newConfig.metaVerifyToken.trim() : current.metaVerifyToken,
      geminiApiKey: newConfig.geminiApiKey !== undefined ? newConfig.geminiApiKey.trim() : current.geminiApiKey,
      iceServers: newConfig.iceServers !== undefined ? newConfig.iceServers.trim() : current.iceServers
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    console.log('[DB] Configuración guardada correctamente en database.json');
    return true;
  } catch (error) {
    console.error('[DB] Error al guardar la configuración en la base de datos:', error.message);
    return false;
  }
}

module.exports = {
  getConfig,
  saveConfig
};
