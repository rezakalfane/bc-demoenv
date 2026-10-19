// Single-user "local" mode: no login, one fixed account. Plain module (no
// server-only) because next.config.ts also reads it.
//
//   AUTH_MODE=local|clerk   explicit choice
//   (unset)                 local when no Clerk keys are configured, else clerk
//   LOCAL_USER_ID           account id data is stored under (default "local-user")
//   LOCAL_USER_EMAIL        shown in the app (default "local@localhost")
//
// Local mode is ignored on Vercel, so a deployment can never run without login.

export function isLocalAuth() {
  if (process.env.VERCEL) return false;
  const mode = process.env.AUTH_MODE?.trim().toLowerCase();
  if (mode === "local") return true;
  if (mode === "clerk") return false;
  return !(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

function titleCase(word: string) {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export function getLocalUser() {
  const email = (process.env.LOCAL_USER_EMAIL?.trim() || "local@localhost").toLowerCase();
  const [first = "", ...rest] = email.split("@")[0].split(/[._-]+/);
  return {
    id: process.env.LOCAL_USER_ID?.trim() || "local-user",
    email,
    firstName: titleCase(first),
    lastName: rest.map(titleCase).join(" "),
    imageUrl: "",
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Local mode has no login, so only answer requests addressed to this machine. */
export function isLoopbackHost(hostHeader: string | null) {
  const host = (hostHeader ?? "").toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(host);
}
