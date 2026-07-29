const crypto = require("crypto");

// AES-256-GCM helpers for per-client secrets (Convert credentials, ClickUp OAuth
// tokens) stored in Firestore. Format: iv(hex):authTag(hex):ciphertext(hex).

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_IV_LENGTH = 16;

function getEncryptionKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte (64 hex char) value");
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext) {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !dataHex) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final("utf8");
}

// Convert.com credentials may be stored either as plaintext (legacy createUserDirectly
// flow) or as AES-encrypted blobs (rotate-credentials flow). Try decrypt, fall back to
// the raw value if it doesn't look encrypted.
function readConvertCredential(value) {
  const s = String(value ?? "");
  if (!s) return "";
  if (/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(s)) {
    try { return decrypt(s); } catch { /* fall through */ }
  }
  return s;
}

module.exports = { encrypt, decrypt, readConvertCredential };
