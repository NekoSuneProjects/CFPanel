const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeRaw(data) {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function encryptToken(token) {
  if (!token) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure OS encryption is unavailable. CFPanel will not save the API token unencrypted.");
  }
  return safeStorage.encryptString(token).toString("base64");
}

function decryptToken(value) {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure OS encryption is unavailable, so the saved token cannot be decrypted.");
  }
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function getSettings() {
  const raw = readRaw();
  return {
    accountId: raw.accountId || "",
    hasToken: Boolean(raw.apiTokenEncrypted)
  };
}

function getCredentials() {
  const raw = readRaw();
  return {
    accountId: raw.accountId || "",
    apiToken: decryptToken(raw.apiTokenEncrypted || "")
  };
}

function saveSettings({ accountId, apiToken }) {
  const current = readRaw();
  const next = {
    accountId: String(accountId || "").trim(),
    apiTokenEncrypted: apiToken
      ? encryptToken(String(apiToken).trim())
      : current.apiTokenEncrypted || ""
  };
  writeRaw(next);
  return getSettings();
}

function clearToken() {
  const raw = readRaw();
  delete raw.apiTokenEncrypted;
  writeRaw(raw);
  return getSettings();
}

module.exports = { getSettings, getCredentials, saveSettings, clearToken };
