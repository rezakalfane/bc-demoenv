import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const rootSecret =
    process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.CLERK_SECRET_KEY;

  if (!rootSecret) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is missing. Add a strong secret before saving BigCommerce access tokens.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(rootSecret, "utf8"),
      Buffer.from("bc-demoenv-settings", "utf8"),
      Buffer.from("bigcommerce-access-token-v1", "utf8"),
      32,
    ),
  );
}

function getAdditionalData(userId: string) {
  return Buffer.from(`bigcommerce-environment:${userId}`, "utf8");
}

export function encryptSecret(value: string, userId: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  cipher.setAAD(getAdditionalData(userId));

  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string, userId: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
    value.split(".");

  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext
  ) {
    throw new Error("The encrypted setting has an unsupported format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(getAdditionalData(userId));
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
