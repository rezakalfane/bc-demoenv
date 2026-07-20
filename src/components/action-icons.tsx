import type { SVGProps } from "react";

const iconProps: SVGProps<SVGSVGElement> = {
  width: 9,
  height: 9,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function CameraIcon() {
  return <svg {...iconProps}><path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3.5" /></svg>;
}

export function PlusIcon() {
  return <svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>;
}

export function RestoreIcon() {
  return <svg {...iconProps}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>;
}

export function VersionsIcon() {
  return <svg {...iconProps}><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 5V3h10a2 2 0 0 1 2 2v10h-2" /></svg>;
}

export function HistoryIcon() {
  return <svg {...iconProps}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>;
}

export function InspectIcon() {
  return <svg {...iconProps}><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /><circle cx="17" cy="16" r="2.5" /><path d="m19 18 2 2" /></svg>;
}

export function TrashIcon() {
  return <svg {...iconProps}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

export function PublishedIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      {...iconProps}
      width={14}
      height={14}
      className={className}
    >
      <path d="M12 3 9.8 7.5 5 8.2l3.5 3.4-.8 4.8 4.3-2.3 4.3 2.3-.8-4.8L19 8.2l-4.8-.7Z" />
      <path d="m9.7 11.2 1.5 1.5 3.3-3.5" />
    </svg>
  );
}
