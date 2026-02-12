import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Try to redirect back to the locale the user was on
  const referer = request.headers.get("referer") ?? "";
  const localeMatch = referer.match(/\/([a-z]{2})\//);
  const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}`;
  return NextResponse.redirect(url, { status: 302 });
}
