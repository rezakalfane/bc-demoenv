"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import {
  testEnvironmentAccess,
  type EnvironmentDiagnosticsActionState,
} from "@/app/(app)/settings/actions";
import type {
  CredentialDiagnosticsReport,
  CredentialOperationStatus,
  CredentialProbeStatus,
} from "@/lib/bigcommerce-credential-diagnostics";
import type { BigCommerceEnvironment } from "@/lib/db";

const initialState: EnvironmentDiagnosticsActionState = {
  status: "idle",
  message: "",
  report: null,
};

const operationStyles: Record<CredentialOperationStatus, string> = {
  available: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  limited: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  unavailable: "bg-red-500/12 text-red-700 dark:text-red-300",
  not_verified: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};

const operationLabels: Record<CredentialOperationStatus, string> = {
  available: "Available",
  limited: "Limited",
  unavailable: "Unavailable",
  not_verified: "Write not tested",
};

const probeLabels: Record<CredentialProbeStatus, string> = {
  available: "Available",
  missing_scope: "Missing scope",
  unavailable: "Unavailable",
  invalid_credentials: "Invalid token",
  rate_limited: "Rate limited",
  error: "Error",
};

function TestAccessButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/8 px-3.5 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-600/50 hover:bg-emerald-500/12 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
    >
      {pending ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4 animate-spin"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-25"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
          <path
            d="M4 12.5 9 17l11-11"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      )}
      {pending ? "Testing access…" : "Test access"}
    </button>
  );
}

function ReportStatus({ report }: { report: CredentialDiagnosticsReport }) {
  const styles = report.status === "connected"
    ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    : report.status === "partial"
      ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
      : "bg-red-500/12 text-red-700 dark:text-red-300";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${styles}`}>
      {report.status}
    </span>
  );
}

function AccessReport({ report }: { report: CredentialDiagnosticsReport }) {
  const b2bEnabled = report.b2b.status === "enabled";

  return (
    <section
      aria-label={`Access report for ${report.environmentName}`}
      className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 sm:p-5 dark:border-white/8 dark:bg-white/[0.025]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">Credential scope report</h4>
            <ReportStatus report={report} />
          </div>
          <p className="mt-1 text-sm text-black/55 dark:text-white/55">
            {report.summary}
          </p>
        </div>
        <p className="text-xs text-black/40 dark:text-white/40">
          Tested {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(report.testedAt))}
        </p>
      </div>

      <div className="mt-5">
        <h5 className="text-xs font-semibold uppercase tracking-[0.14em] text-black/40 dark:text-white/40">
          Available operations
        </h5>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {report.operations.map((item) => (
            <li
              key={item.label}
              className="rounded-xl border border-black/8 bg-white/60 p-3 dark:border-white/8 dark:bg-white/3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{item.label}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${operationStyles[item.status]}`}>
                  {operationLabels[item.status]}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-black/50 dark:text-white/50">
                {item.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-black/8 p-3 dark:border-white/8">
          <h5 className="text-sm font-semibold">Missing scopes</h5>
          {report.missingScopes.length === 0 ? (
            <p className="mt-2 text-xs leading-5 text-black/50 dark:text-white/50">
              No missing read scope was inferred from the tested endpoints.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-xs leading-5 text-red-700 dark:text-red-300">
              {report.missingScopes.map((item) => (
                <li key={item.scope}>
                  <span className="font-semibold">{item.scope}</span> — {item.detail}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-black/8 p-3 dark:border-white/8">
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-sm font-semibold">B2B availability</h5>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              b2bEnabled
                ? operationStyles.available
                : report.b2b.status === "available"
                  ? operationStyles.limited
                  : operationStyles.unavailable
            }`}>
              {b2bEnabled ? "Enabled" : report.b2b.status.replace("_", " ")}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-black/50 dark:text-white/50">
            {report.b2b.summary}
          </p>
          {report.b2b.channels.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-black/60 dark:text-white/60">
                Channel details
              </summary>
              <ul className="mt-2 space-y-1.5 text-xs text-black/50 dark:text-white/50">
                {report.b2b.channels.map((channel) => (
                  <li key={channel.id}>
                    <span className="font-medium text-black/70 dark:text-white/70">
                      {channel.name}:
                    </span>{" "}
                    {channel.status.replace("_", " ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="rounded-xl border border-black/8 p-3 dark:border-white/8">
          <h5 className="text-sm font-semibold">Unavailable APIs</h5>
          {report.unavailableApis.length === 0 ? (
            <p className="mt-2 text-xs leading-5 text-black/50 dark:text-white/50">
              No tested API was unavailable for this store or channel type.
            </p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs leading-5 text-black/50 dark:text-white/50">
              {report.unavailableApis.map((item) => (
                <li key={`${item.label}-${item.detail}`}>
                  <span className="font-semibold text-black/70 dark:text-white/70">
                    {item.label}
                  </span> — {item.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details className="mt-4 border-t border-black/8 pt-3 dark:border-white/8">
        <summary className="cursor-pointer text-xs font-medium text-black/55 dark:text-white/55">
          View all read-only API probes
        </summary>
        <ul className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {report.probes.map((probe) => (
            <li key={probe.id} className="flex items-start justify-between gap-3 text-xs">
              <span>
                <span className="font-medium">{probe.label}</span>
                <span className="block text-black/40 dark:text-white/40">{probe.scope}</span>
              </span>
              <span className="shrink-0 text-right text-black/55 dark:text-white/55">
                {probeLabels[probe.status]}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <p className="mt-4 text-xs leading-5 text-black/40 dark:text-white/40">
        This diagnostic sends read-only API requests. BigCommerce tokens do not expose a scope list,
        so missing read scopes are inferred from API responses and modify access is not exercised.
      </p>
    </section>
  );
}

function AccessReportModal({
  report,
  onClose,
}: {
  report: CredentialDiagnosticsReport;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`access-report-title-${report.environmentId}`}
        className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-white shadow-2xl dark:bg-neutral-950"
      >
        <header className="border-b border-black/8 px-6 pt-6 pb-4 sm:px-7 sm:pt-7 dark:border-white/8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Access diagnostics
              </p>
              <h3
                id={`access-report-title-${report.environmentId}`}
                className="mt-1 break-words text-2xl font-semibold tracking-[-0.03em]"
              >
                {report.environmentName}
              </h3>
              <p className="mt-1 font-mono text-xs text-black/45 dark:text-white/45">
                Store {report.storeHash}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close access report"
              className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black focus:outline-none focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
            >
              ×
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 text-black/55 dark:text-white/55">
            Review the read capabilities available to this credential, inferred missing scopes,
            B2B channel availability, and APIs unsupported by the store or channel type.
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
          <AccessReport report={report} />
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function EnvironmentAccessDiagnostics({
  environment,
  compact = false,
}: {
  environment: BigCommerceEnvironment;
  compact?: boolean;
}) {
  const action = testEnvironmentAccess.bind(null, environment.id);
  const [state, formAction] = useActionState(action, initialState);
  const [dismissedReportAt, setDismissedReportAt] = useState<string | null>(null);
  const isReportOpen = Boolean(
    state.report && dismissedReportAt !== state.report.testedAt,
  );
  const closeReport = useCallback(() => {
    if (state.report) setDismissedReportAt(state.report.testedAt);
  }, [state.report]);

  return (
    <div className={compact ? "" : "mt-5 border-t border-black/8 pt-4 dark:border-white/8"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!compact ? <div>
          <p className="text-sm font-medium">Access diagnostics</p>
          <p className="mt-0.5 text-xs text-black/45 dark:text-white/45">
            Verify safe read capabilities, inferred scopes, and store-specific APIs.
          </p>
        </div> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.report && (
            <button
              type="button"
              onClick={() => setDismissedReportAt(null)}
              className="min-h-9 rounded-xl border border-black/10 px-3.5 py-2 text-sm font-medium text-black/60 transition hover:bg-black/5 hover:text-black focus:outline-none focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
            >
              View report
            </button>
          )}
          <form action={formAction}>
            <TestAccessButton />
          </form>
        </div>
      </div>

      <div aria-live="polite">
        {state.status === "error" && (
          <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {state.message}
          </p>
        )}
      </div>
      {state.report && isReportOpen && (
        <AccessReportModal
          report={state.report}
          onClose={closeReport}
        />
      )}
    </div>
  );
}
