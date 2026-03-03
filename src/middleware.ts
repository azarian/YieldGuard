import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Skip locale routing for API routes and auth callbacks
  if (request.nextUrl.pathname.startsWith("/api/") ||
      request.nextUrl.pathname.startsWith("/auth/")) {
    return NextResponse.next();
  }

  // 1. Run the intl middleware first to handle locale detection/redirect
  const intlResponse = intlMiddleware(request);

  // 2. Create the Supabase client, piping cookies through the intl response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            intlResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // 3. Refresh the session (important for keeping users logged in)
  //    Wrapped in try-catch: in dev mode the edge runtime sandbox may block
  //    outgoing fetch calls. When that happens, fall through without auth guards
  //    and let the page-level server components handle authentication instead.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // fetch to Supabase failed (e.g. edge-runtime sandbox in dev mode).
    // Return the intl response as-is — pages will do their own auth check.
    return intlResponse;
  }

  // 4. Extract the pathname without the locale prefix for auth checks
  const { pathname } = request.nextUrl;
  // Matches /en/dashboard, /he/dashboard, etc.
  const isDashboard = /^\/[a-z]{2}\/dashboard/.test(pathname);
  const isLogin = /^\/[a-z]{2}\/login$/.test(pathname);
  const isSignup = /^\/[a-z]{2}\/signup$/.test(pathname);

  // Extract the locale from the path (e.g. "/en/..." -> "en")
  const localeMatch = pathname.match(/^\/([a-z]{2})\//);
  const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;

  // 5. Auth guards
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  if (user && (isLogin || isSignup)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/dashboard`;
    return NextResponse.redirect(url);
  }

  return intlResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
