"use server";

import { revalidatePath } from "next/cache";
import { addNote as insertNote, removeNote } from "@/lib/db";

export async function addNote(formData: FormData) {
  const title = formData.get("title")?.toString().trim();

  if (!title || title.length > 120) {
    return;
  }

  await insertNote(title);
  revalidatePath("/");
}

export async function deleteNote(formData: FormData) {
  const id = Number(formData.get("id"));

  if (!Number.isSafeInteger(id) || id < 1) {
    return;
  }

  await removeNote(id);
  revalidatePath("/");
}
