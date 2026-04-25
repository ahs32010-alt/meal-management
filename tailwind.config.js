/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        arabic: ['Cairo', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },
    },
  },
  safelist: [
    // Stat cards colors
    'bg-blue-50', 'text-blue-700', 'border-blue-100', 'bg-blue-100', 'text-blue-600',
    'bg-emerald-50', 'text-emerald-700', 'border-emerald-100', 'bg-emerald-100', 'text-emerald-600',
    'bg-violet-50', 'text-violet-700', 'border-violet-100', 'bg-violet-100', 'text-violet-600',
    // Meal type badges
    'bg-yellow-100', 'text-yellow-700',
    'bg-blue-100', 'text-blue-700',
    'bg-purple-100', 'text-purple-700',
    'bg-slate-100', 'text-slate-700',
    // Others
    'bg-slate-50', 'text-slate-600', 'text-slate-800', 'text-slate-400',
    'text-emerald-600', 'text-red-400', 'bg-red-900/30',
  ],
  plugins: [],
};
