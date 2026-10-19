import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isLocalAuth, isLoopbackHost } from "@/lib/auth-mode";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/verify(.*)",
  "/access-denied(.*)",
  // Cron has no Clerk session; the route checks CRON_SECRET itself.
  "/api/scheduler/tick",
  // Content-hash-named image copies, fetched by <img>/next/image.
  "/api/snapshot-images/(.*)",
]);

const clerk = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
}, { signInUrl: "/sign-in", signUpUrl: "/sign-in" });

const LOGIN_PAGES = /^\/(?:sign-in|verify|access-denied)(?:\/|$)/;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isLocalAuth()) return clerk(request, event);

  // Single-user local mode: no login. The app holds store admin tokens, so it
  // must not answer anything that is not addressed to this machine.
  // Exception: Next's image optimizer fetches local images through an internal
  // request that carries no Host header. That route only serves content-hash
  // named image files, so it is safe to leave open.
  const isImageRoute = request.nextUrl.pathname.startsWith("/api/snapshot-images/");
  if (!isImageRoute && !isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("Local mode only answers on localhost.", { status: 403 });
  }
  if (LOGIN_PAGES.test(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|.well-known/workflow/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
