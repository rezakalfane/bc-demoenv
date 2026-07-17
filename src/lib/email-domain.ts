export const ALLOWED_EMAIL_DOMAINS = [
  "bigcommerce.com",
  "commerce.com",
] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string) {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return false;
  }

  return ALLOWED_EMAIL_DOMAINS.some((domain) => parts[1] === domain);
}
