# نظام إدارة الوجبات — دليل الإعداد

## الخطوات الكاملة للتشغيل

---

## 1. إعداد Supabase

### أ) إنشاء مشروع جديد
1. اذهب إلى [supabase.com](https://supabase.com) وسجّل دخولك
2. اضغط **New Project** وأنشئ مشروعاً جديداً
3. احفظ كلمة المرور

### ب) إنشاء قاعدة البيانات
1. في Supabase Dashboard، اذهب إلى **SQL Editor**
2. اضغط **New Query**
3. انسخ محتوى ملف `supabase/schema.sql` والصقه في المحرر
4. اضغط **Run** لتنفيذه
5. كرر نفس الخطوة مع ملف `supabase/seed.sql` (بيانات تجريبية)

### ج) إنشاء حساب مدير
1. في Supabase Dashboard، اذهب إلى **Authentication > Users**
2. اضغط **Add User > Create new user**
3. أدخل البريد الإلكتروني وكلمة المرور التي ستستخدمها لتسجيل الدخول
4. تأكد من تفعيل **Email Confirmed**

### د) نسخ مفاتيح API
1. في Supabase Dashboard، اذهب إلى **Settings > API**
2. انسخ:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 2. إعداد المشروع محلياً

```bash
# انسخ ملف البيئة
cp .env.local.example .env.local
```

افتح ملف `.env.local` وأضف قيمك:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 3. تشغيل المشروع محلياً

```bash
# تثبيت الحزم (إذا لم تكن مثبتة)
npm install

# تشغيل خادم التطوير
npm run dev
```

افتح المتصفح على: **http://localhost:3000**

---

## 4. النشر على Vercel

### أ) رفع المشروع على GitHub
```bash
git init
git add .
git commit -m "Initial commit: نظام إدارة الوجبات"
git remote add origin https://github.com/username/meal-management.git
git push -u origin main
```

### ب) ربط Vercel بـ GitHub
1. اذهب إلى [vercel.com](https://vercel.com) وسجّل دخولك
2. اضغط **Add New Project**
3. اختر المستودع من GitHub
4. قبل النشر، أضف متغيرات البيئة:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. اضغط **Deploy**

---

## هيكل المشروع

```
kha-clod/
├── app/
│   ├── (auth)/login/          # صفحة تسجيل الدخول
│   ├── (dashboard)/           # صفحات الداشبورد
│   │   ├── layout.tsx         # تخطيط مع Sidebar
│   │   ├── page.tsx           # لوحة التحكم الرئيسية
│   │   ├── beneficiaries/     # المستفيدون
│   │   ├── meals/             # الأصناف
│   │   ├── orders/            # أوامر التشغيل
│   │   └── reports/           # التقارير
│   └── api/
│       └── orders/[id]/report/  # API توليد التقرير
├── components/
│   ├── layout/               # Sidebar + Header
│   ├── beneficiaries/        # مكونات المستفيدين
│   ├── meals/                # مكونات الأصناف
│   ├── orders/               # مكونات الأوامر
│   └── reports/              # مكون التقرير
├── lib/
│   ├── types.ts              # أنواع TypeScript
│   ├── supabase-client.ts    # عميل Browser
│   └── supabase-server.ts    # عميل Server
├── supabase/
│   ├── schema.sql            # هيكل قاعدة البيانات
│   └── seed.sql              # بيانات تجريبية
└── middleware.ts             # حماية المسارات
```

---

## الميزات المنجزة

- ✅ تسجيل دخول محمي بـ Supabase Auth
- ✅ لوحة تحكم مع إحصائيات
- ✅ إدارة المستفيدين (CRUD + الأصناف الممنوعة)
- ✅ إدارة الأصناف (رئيسية + بديلة مع الربط)
- ✅ إنشاء أوامر التشغيل اليومية
- ✅ توليد التقارير مع منطق الاستبدال التلقائي
- ✅ طباعة / تصدير PDF
- ✅ واجهة عربية RTL كاملة
- ✅ بيانات تجريبية جاهزة
