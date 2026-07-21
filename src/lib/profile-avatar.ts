export const PROFILE_AVATAR_UPLOAD_MAX_LENGTH = 350_000;

export function isValidProfileAvatar(value: string) {
  if (!value) return true;
  if (value === "initials") return true;
  if (/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return value.length <= PROFILE_AVATAR_UPLOAD_MAX_LENGTH;
  }
  if (value.length <= 2_048) {
    try {
      const url = new URL(value);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }
  return false;
}
