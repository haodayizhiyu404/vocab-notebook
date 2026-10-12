/**
 * config.js · 生词本全局配置（extension_settings，本机）
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const KEY = 'vocab-notebook';
const DEFAULTS = { captureEnabled: true }; // 选词收录总开关

export function getConfig() {
    extension_settings[KEY] = Object.assign({}, DEFAULTS, extension_settings[KEY]);
    return extension_settings[KEY];
}

export function saveConfig() {
    saveSettingsDebounced();
}
