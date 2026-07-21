import "server-only";

type DatabaseMaintenanceUser = {
  email: string;
};

function configuredEmails() {
  return new Set(
    (process.env.DATABASE_BACKUP_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canMaintainDatabase(user: DatabaseMaintenanceUser) {
  if (process.env.NODE_ENV === "development") return true;
  return configuredEmails().has(user.email.trim().toLowerCase());
}

export function assertCanMaintainDatabase(user: DatabaseMaintenanceUser) {
  if (!canMaintainDatabase(user)) {
    throw new Error(
      "Whole-database backup and restore require this email in DATABASE_BACKUP_ALLOWED_EMAILS.",
    );
  }
}
