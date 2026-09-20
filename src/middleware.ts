import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "sos_session";
const PUBLIC_PATHS = ["/login", "/register"];

/**
 * Hızlı ön kontrol: oturum çerezi yoksa korumalı sayfalardan /login'e yönlendirir.
 * Gerçek oturum ve şirket üyeliği doğrulaması sunucu tarafında (layout / action) yapılır.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic && pathname !== "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
