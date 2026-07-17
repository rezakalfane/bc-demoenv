"use server";

import { revalidatePath } from "next/cache";
import { addNote as insertNote, removeNote } from "@/lib/db";
import { requireAppUser } from "@/lib/auth";

export async function addNote(formData: FormData) {
  const user = await requireAppUser();
  const title = formData.get("title")?.toString().trim();

  if (!title || title.length > 120) {
    return;
  }

  await insertNote(user.id, title);
  revalidatePath("/notes");
}

export async function deleteNote(formData: FormData) {
  const user = await requireAppUser();
  const id = Number(formData.get("id"));

  if (!Number.isSafeInteger(id) || id < 1) {
    return;
  }

  await removeNote(user.id, id);
  revalidatePath("/notes");
}
