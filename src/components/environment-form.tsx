"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { BigCommerceEnvironment } from "@/lib/db";
import {
  createEnvironment,
  deleteEnvironment,
  editEnvironment,
} from "@/app/(app)/settings/actions";

const initialEnvironmentActionState = {
  status: "idle" as const,
  message: "",
};

function SaveButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
    >
      {pending
        ? isEditing
          ? "Saving…"
          : "Adding…"
        : isEditing
          ? "Save changes"
          : "Add environment"}
    </button>
  );
}

export function EnvironmentForm({
  environment,
}: {
  environment?: BigCommerceEnvironment;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const isEditing = Boolean(environment);
  const action = isEditing ? editEnvironment : createEnvironment;
  const [state, formAction] = useActionState(
    action,
    initialEnvironmentActionState,
  );

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    if (!isEditing) {
      formRef.current?.reset();
      return;
    }

    const tokenInput = formRef.current?.elements.namedItem("accessToken");
    if (tokenInput instanceof HTMLInputElement) {
      tokenInput.value = "";
    }
  }, [isEditing, state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {environment && <input type="hidden" name="id" value={environment.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Name
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={environment?.name}
            placeholder="Production"
            className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-black/30 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/25"
          />
        </label>

        <label className="block text-sm font-medium">
          Store hash
          <input
            name="storeHash"
            type="text"
            required
            minLength={3}
            maxLength={64}
            pattern="[A-Za-z0-9]+"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={environment?.storeHash}
            placeholder="abc123def4"
            className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 font-mono text-sm shadow-sm outline-none transition placeholder:text-black/30 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/25"
          />
        </label>
      </div>

      <label className="block text-sm font-medium">
        Access token
        <input
          name="accessToken"
          type="password"
          required={!isEditing}
          maxLength={4096}
          autoComplete="new-password"
          placeholder={
            environment
              ? `Leave blank to keep token ending in ${environment.accessTokenHint}`
              : "Paste the BigCommerce API access token"
          }
          className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 font-mono text-sm shadow-sm outline-none transition placeholder:font-sans placeholder:text-black/30 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/25"
        />
        <span className="mt-2 block text-xs font-normal text-black/40 dark:text-white/40">
          {environment
            ? "Enter a new token only when you want to replace the saved one."
            : "The token is encrypted before it is stored."}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton isEditing={isEditing} />
        <p
          aria-live="polite"
          className={`text-sm ${
            state.status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm font-medium text-red-600 transition hover:text-red-700 disabled:cursor-wait disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

export function DeleteEnvironmentForm({
  environment,
}: {
  environment: BigCommerceEnvironment;
}) {
  return (
    <form
      action={deleteEnvironment}
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${environment.name}?`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={environment.id} />
      <DeleteButton />
    </form>
  );
}
