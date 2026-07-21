export function ProfileAvatar({
  value,
  initials,
  className = "size-9 text-xs",
}: {
  value: string;
  initials: string;
  className?: string;
}) {
  const imageValue = value !== "initials" && !value.startsWith("preset:") ? value : "";

  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-emerald-500/12 font-semibold text-emerald-800 dark:border-white/10 dark:bg-emerald-400/12 dark:text-emerald-200 ${className}`}
    >
      {imageValue ? (
        // Uploads are already cropped to a compact square. A native image also
        // supports data URLs and Clerk-hosted fallbacks without remote-host rules.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="absolute inset-0 block size-full object-cover" src={imageValue} />
      ) : (
        initials
      )}
    </span>
  );
}
