import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cachedByToken } from '@/lib/auth-cache';

function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
}

export async function middleware(request: NextRequest) {
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!hasSupabaseAuthCookie(request)) {
    if (!isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  /**
   * `getUser()` يتحقّق من الرمز عبر الشبكة (٣٣٥–٤٨٠ms في هذا المشروع)، وهذا
   * الوسيط يعمل في **كل تنقّل** — فكان نصف ثانية يضيع قبل رسم أي صفحة.
   *
   * `getSession()` يقرأ الكوكيز محلياً بلا شبكة، فنأخذ منه الرمز ونستخدمه
   * مفتاحاً لذاكرة قصيرة: نفس الرمز لا يُتحقَّق منه أكثر من مرّة كل ١٥ ثانية.
   * التحقّق نفسه لم يتغيّر ولم يضعف — الرمز المزوّر يُرفض في أول نداء كما كان،
   * والبيانات محميّة بـRLS في كل طلب على أي حال.
   */
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const user = token
    ? await cachedByToken(token, async () => (await supabase.auth.getUser()).data.user)
    : (await supabase.auth.getUser()).data.user;

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!api|_next|.*\\..*).*)',
  ],
};
