"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  ALLOWED_EMAIL_DOMAINS,
  isAllowedEmail,
  normalizeEmail,
} from "@/lib/email-domain";

type ClerkErrorLike = {
  code?: string;
  longMessage?: string;
  message?: string;
  errors?: Array<{
    code?: string;
    longMessage?: string;
    message?: string;
  }>;
};

type DeliveryMethod = "code" | "link";
type AuthStep = "email" | "code" | "link";
type CodeOwner = "signIn" | "signUp";

function hasErrorCode(error: ClerkErrorLike | null, code: string) {
  return (
    error?.code === code || error?.errors?.some((item) => item.code === code)
  );
}

function getErrorMessage(error: ClerkErrorLike | null, fallback: string) {
  return (
    error?.longMessage ??
    error?.message ??
    error?.errors?.[0]?.longMessage ??
    error?.errors?.[0]?.message ??
    fallback
  );
}

export function PasswordlessAuthForm() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();
  const linkAttemptRef = useRef(0);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [deliveryMethod, setDeliveryMethod] =
    useState<DeliveryMethod>("code");
  const [codeOwner, setCodeOwner] = useState<CodeOwner>("signIn");
  const [step, setStep] = useState<AuthStep>("email");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const navigateHome = (url: string) => {
    if (url.startsWith("http")) {
      window.location.href = url;
      return;
    }

    router.replace(url);
    router.refresh();
  };

  const finalizeSignIn = async () => {
    const { error: finalizeError } = await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          setError("Your account needs an additional setup step in Clerk.");
          setIsBusy(false);
          return;
        }

        navigateHome(decorateUrl("/"));
      },
    });

    if (finalizeError) {
      setError(
        getErrorMessage(finalizeError, "We could not finish signing you in."),
      );
      setStep("email");
      setIsBusy(false);
    }
  };

  const finalizeSignUp = async () => {
    const { error: finalizeError } = await signUp.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          setError("Your account needs an additional setup step in Clerk.");
          setIsBusy(false);
          return;
        }

        navigateHome(decorateUrl("/"));
      },
    });

    if (finalizeError) {
      setError(
        getErrorMessage(
          finalizeError,
          "We could not finish creating your account.",
        ),
      );
      setStep("email");
      setIsBusy(false);
    }
  };

  const showMissingSignUpRequirements = () => {
    const missingFields = signUp.missingFields ?? [];

    if (missingFields.includes("password")) {
      setError(
        "Clerk still requires a password for new accounts. Disable required passwords in User & authentication so email-code sign-up can complete.",
      );
    } else {
      setError(
        missingFields.length > 0
          ? `Clerk requires additional sign-up fields: ${missingFields.join(", ")}.`
          : "Clerk could not complete the new account. Check the sign-up requirements.",
      );
    }

    setStep("email");
    setIsBusy(false);
  };

  const startSignUpWithCode = async (emailAddress: string) => {
    const { error: createError } = await signUp.create({ emailAddress });

    if (createError) {
      setError(
        getErrorMessage(createError, "We could not create your account."),
      );
      setStep("email");
      setIsBusy(false);
      return;
    }

    if (signUp.status === "complete") {
      await finalizeSignUp();
      return;
    }

    const { error: sendError } = await signUp.verifications.sendEmailCode();

    if (sendError) {
      setError(
        getErrorMessage(
          sendError,
          "We could not send the sign-up verification code.",
        ),
      );
      setStep("email");
      setIsBusy(false);
      return;
    }

    setCode("");
    setCodeOwner("signUp");
    setStep("code");
    setIsBusy(false);
  };

  const needsSignUp = (clerkError: ClerkErrorLike | null) =>
    hasErrorCode(clerkError, "form_identifier_not_found") ||
    hasErrorCode(clerkError, "sign_up_if_missing_transfer");

  const completeVerification = async (
    verificationError: ClerkErrorLike | null,
  ) => {
    if (verificationError) {
      if (needsSignUp(verificationError)) {
        await startSignUpWithCode(email);
        return;
      }

      setError(
        getErrorMessage(
          verificationError,
          "The verification expired or could not be completed. Please try again.",
        ),
      );
      setStep("email");
      setIsBusy(false);
      return;
    }

    if (signIn.status === "complete") {
      await finalizeSignIn();
      return;
    }

    setError("The sign-in attempt did not complete. Please try again.");
    setStep("email");
    setIsBusy(false);
  };

  const startAuthentication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    const emailAddress = normalizeEmail(email);

    if (!isAllowedEmail(emailAddress)) {
      setError(
        `Use an @${ALLOWED_EMAIL_DOMAINS[0]} or @${ALLOWED_EMAIL_DOMAINS[1]} email address.`,
      );
      setIsBusy(false);
      return;
    }

    setEmail(emailAddress);

    const { error: createError } = await signIn.create({
      identifier: emailAddress,
    });

    if (createError) {
      if (needsSignUp(createError)) {
        await startSignUpWithCode(emailAddress);
        return;
      }

      setError(getErrorMessage(createError, "We could not start sign-in."));
      setIsBusy(false);
      return;
    }

    if (deliveryMethod === "code") {
      const { error: sendError } = await signIn.emailCode.sendCode();

      if (sendError) {
        if (needsSignUp(sendError)) {
          await startSignUpWithCode(emailAddress);
          return;
        }

        setError(
          getErrorMessage(sendError, "We could not send the email code."),
        );
        setIsBusy(false);
        return;
      }

      setCode("");
      setCodeOwner("signIn");
      setStep("code");
      setIsBusy(false);
      return;
    }

    const { error: sendError } = await signIn.emailLink.sendLink({
      verificationUrl: `${window.location.origin}/verify`,
    });

    if (sendError) {
      if (needsSignUp(sendError)) {
        await startSignUpWithCode(emailAddress);
        return;
      }

      setError(
        getErrorMessage(sendError, "We could not send the email link."),
      );
      setIsBusy(false);
      return;
    }

    const linkAttempt = ++linkAttemptRef.current;
    setStep("link");
    setIsBusy(false);

    const { error: verificationError } =
      await signIn.emailLink.waitForVerification();

    if (linkAttempt !== linkAttemptRef.current) {
      return;
    }

    setIsBusy(true);
    await completeVerification(verificationError);
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    if (codeOwner === "signUp") {
      const { error: verificationError } =
        await signUp.verifications.verifyEmailCode({ code: code.trim() });

      if (verificationError) {
        setError(
          getErrorMessage(
            verificationError,
            "The sign-up code is invalid or expired. Please try again.",
          ),
        );
        setIsBusy(false);
        return;
      }

      if (signUp.status === "complete") {
        await finalizeSignUp();
        return;
      }

      showMissingSignUpRequirements();
      return;
    }

    const { error: verificationError } = await signIn.emailCode.verifyCode({
      code: code.trim(),
    });

    await completeVerification(verificationError);
  };

  const resendCode = async () => {
    setError(null);
    setIsBusy(true);
    const { error: sendError } =
      codeOwner === "signUp"
        ? await signUp.verifications.sendEmailCode()
        : await signIn.emailCode.sendCode();

    if (sendError) {
      setError(getErrorMessage(sendError, "We could not resend the code."));
    }

    setIsBusy(false);
  };

  const startOver = async () => {
    linkAttemptRef.current += 1;
    setCode("");
    setCodeOwner("signIn");
    setError(null);
    setIsBusy(false);
    setStep("email");
    await Promise.all([signIn.reset(), signUp.reset()]);
  };

  if (step === "link") {
    return (
      <div className="rounded-3xl border border-black/10 bg-white/70 p-7 shadow-[0_18px_60px_rgba(0,0,0,0.07)] backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-emerald-500/12 text-xl text-emerald-700 dark:text-emerald-300">
          ↗
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
        <p className="mt-2 text-sm leading-6 text-black/55 dark:text-white/55">
          We sent a secure login link to <strong>{email}</strong>. Open it to
          finish verification. The verification tab can be closed; this page
          will sign you in automatically.
        </p>
        <p className="mt-4 flex items-center gap-2 text-xs text-black/40 dark:text-white/40">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          Waiting for verification…
        </p>
        <button
          type="button"
          onClick={startOver}
          className="mt-6 text-sm font-medium text-black/50 underline decoration-black/20 underline-offset-4 transition hover:text-black dark:text-white/50 dark:decoration-white/20 dark:hover:text-white"
        >
          Use a different method
        </button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form
        onSubmit={verifyCode}
        className="rounded-3xl border border-black/10 bg-white/70 p-7 shadow-[0_18px_60px_rgba(0,0,0,0.07)] backdrop-blur dark:border-white/10 dark:bg-white/5"
      >
        <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-emerald-500/12 text-lg font-semibold text-emerald-700 dark:text-emerald-300">
          #
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Enter your code</h2>
        <p className="mt-2 text-sm leading-6 text-black/55 dark:text-white/55">
          We sent a one-time code to <strong>{email}</strong>. It works for
          both sign-in and first-time account creation.
        </p>
        <label htmlFor="code" className="mt-5 block text-sm font-medium">
          Verification code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-describedby="code-error"
          className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-center text-lg tracking-[0.3em] shadow-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5"
        />
        {error && (
          <p
            id="code-error"
            role="alert"
            className="mt-4 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isBusy}
          className="mt-6 w-full rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
        >
          {isBusy ? "Verifying…" : "Verify and continue"}
        </button>
        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resendCode}
            disabled={isBusy}
            className="font-medium text-black/50 transition hover:text-black disabled:opacity-50 dark:text-white/50 dark:hover:text-white"
          >
            Resend code
          </button>
          <button
            type="button"
            onClick={startOver}
            className="font-medium text-black/50 transition hover:text-black dark:text-white/50 dark:hover:text-white"
          >
            Start over
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={startAuthentication}
      className="rounded-3xl border border-black/10 bg-white/70 p-7 shadow-[0_18px_60px_rgba(0,0,0,0.07)] backdrop-blur dark:border-white/10 dark:bg-white/5"
    >
      <label htmlFor="email" className="text-sm font-medium">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@bigcommerce.com"
        aria-describedby="email-help email-error"
        className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-sm shadow-sm outline-none transition placeholder:text-black/30 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/25"
      />
      <p id="email-help" className="mt-2 text-xs text-black/40 dark:text-white/40">
        Only BigCommerce and Commerce.com email addresses are allowed.
      </p>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Delivery method</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
          {(["code", "link"] as const).map((method) => (
            <label
              key={method}
              className={`cursor-pointer rounded-xl px-3 py-2.5 text-center text-sm font-medium transition ${
                deliveryMethod === method
                  ? "bg-white text-black shadow-sm dark:bg-white/12 dark:text-white"
                  : "text-black/45 hover:text-black dark:text-white/45 dark:hover:text-white"
              }`}
            >
              <input
                type="radio"
                name="delivery-method"
                value={method}
                checked={deliveryMethod === method}
                onChange={() => setDeliveryMethod(method)}
                className="sr-only"
              />
              {method === "code" ? "Email code" : "Login link"}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p
          id="email-error"
          role="alert"
          className="mt-4 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="mt-6 w-full rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
      >
        {isBusy
          ? "Sending…"
          : deliveryMethod === "code"
            ? "Email me a code"
            : "Email me a login link"}
      </button>
      <div id="clerk-captcha" />
    </form>
  );
}
