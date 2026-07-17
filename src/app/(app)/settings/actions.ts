"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import {
  addBigCommerceEnvironment,
  removeBigCommerceEnvironment,
  updateBigCommerceEnvironment,
} from "@/lib/db";

export type EnvironmentActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

type EnvironmentInput = {
  name: string;
  storeHash: string;
  accessToken?: string;
};

type EnvironmentInputResult =
  | { ok: true; value: EnvironmentInput }
  | { ok: false; error: string };

function readEnvironmentInput(
  formData: FormData,
  requireAccessToken: boolean,
): EnvironmentInputResult {
  const name = formData.get("name")?.toString().trim() ?? "";
  const storeHash =
    formData.get("storeHash")?.toString().trim().toLowerCase() ?? "";
  const accessToken = formData.get("accessToken")?.toString().trim() ?? "";

  if (!name || name.length > 80) {
    return {
      ok: false,
      error: "Name must contain between 1 and 80 characters.",
    };
  }

  if (!/^[a-z0-9]{3,64}$/.test(storeHash)) {
    return {
      ok: false,
      error:
        "Store hash must contain 3–64 lowercase letters or numbers, without spaces.",
    };
  }

  if (requireAccessToken && !accessToken) {
    return { ok: false, error: "Access token is required." };
  }

  if (accessToken.length > 4096) {
    return { ok: false, error: "Access token is too long." };
  }

  return {
    ok: true,
    value: {
      name,
      storeHash,
      accessToken: accessToken || undefined,
    },
  };
}

export async function createEnvironment(
  _previousState: EnvironmentActionState,
  formData: FormData,
): Promise<EnvironmentActionState> {
  const user = await requireAppUser();
  const input = readEnvironmentInput(formData, true);

  if (!input.ok) {
    return { status: "error", message: input.error };
  }

  try {
    await addBigCommerceEnvironment(user.id, {
      ...input.value,
      accessToken: input.value.accessToken!,
    });
  } catch {
    return {
      status: "error",
      message:
        "The environment could not be added. Use a unique name and verify the encryption configuration.",
    };
  }

  revalidatePath("/settings");
  return { status: "success", message: "Environment added." };
}

export async function editEnvironment(
  _previousState: EnvironmentActionState,
  formData: FormData,
): Promise<EnvironmentActionState> {
  const user = await requireAppUser();
  const id = Number(formData.get("id"));
  const input = readEnvironmentInput(formData, false);

  if (!Number.isSafeInteger(id) || id < 1) {
    return { status: "error", message: "Invalid environment." };
  }

  if (!input.ok) {
    return { status: "error", message: input.error };
  }

  try {
    await updateBigCommerceEnvironment(user.id, id, input.value);
  } catch {
    return {
      status: "error",
      message:
        "The environment could not be updated. Use a unique name and verify the encryption configuration.",
    };
  }

  revalidatePath("/settings");
  return { status: "success", message: "Environment updated." };
}

export async function deleteEnvironment(formData: FormData) {
  const user = await requireAppUser();
  const id = Number(formData.get("id"));

  if (!Number.isSafeInteger(id) || id < 1) {
    return;
  }

  await removeBigCommerceEnvironment(user.id, id);
  revalidatePath("/settings");
}
