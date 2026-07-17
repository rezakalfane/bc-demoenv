import { addNote, deleteNote } from "@/app/actions";
import { getNotes } from "@/lib/db";
import { requireAppUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const user = await requireAppUser();
  const notes = await getNotes(user.id);

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-7 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Notes
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Field notes
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-black/55 dark:text-white/55">
              Your private scratchpad for demos, stores, and follow-up tasks.
            </p>
          </div>
          <div className="w-fit rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </div>
        </header>

        <section aria-labelledby="new-note-heading" className="mb-10">
          <h2 id="new-note-heading" className="sr-only">
            Add a note
          </h2>
          <form action={addNote} className="flex gap-3">
            <label htmlFor="note-title" className="sr-only">
              Note
            </label>
            <input
              id="note-title"
              name="title"
              type="text"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="What should you remember?"
              className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-sm shadow-sm outline-none transition placeholder:text-black/35 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/30"
            />
            <button
              type="submit"
              className="rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
            >
              Add note
            </button>
          </form>
        </section>

        <section aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="sr-only">
            Notes
          </h2>
          {notes.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
              <p className="font-medium">Your notebook is empty.</p>
              <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                Add the first note above to verify your database connection.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-black/8 overflow-hidden rounded-3xl border border-black/10 bg-white/65 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur dark:divide-white/8 dark:border-white/10 dark:bg-white/4">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="group flex items-center gap-4 px-5 py-4 sm:px-6"
                >
                  <span className="size-2 shrink-0 rounded-full bg-emerald-500/80" />
                  <p className="min-w-0 flex-1 break-words text-sm leading-6">
                    {note.title}
                  </p>
                  <time
                    className="hidden shrink-0 text-xs text-black/35 sm:block dark:text-white/35"
                    dateTime={note.createdAt}
                  >
                    {new Intl.DateTimeFormat("en", {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(note.createdAt))}
                  </time>
                  <form action={deleteNote}>
                    <input type="hidden" name="id" value={note.id} />
                    <button
                      type="submit"
                      aria-label={`Delete ${note.title}`}
                      className="rounded-lg px-2 py-1 text-xs font-medium text-black/35 transition hover:bg-red-500/10 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:text-white/35 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
