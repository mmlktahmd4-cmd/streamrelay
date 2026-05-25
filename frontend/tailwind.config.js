/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        surface: {
          950: '#070b14',
          900: '#0c1222',
          800: '#131b2e',
          700: '#1a2438',
          600: '#243044',
        },
        accent: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(99, 102, 241, 0.35)',
        'glow-cyan': '0 0 40px -10px rgba(6, 182, 212, 0.35)',
        card: '0 4px 24px -4px rgba(0, 0, 0, 0.45)',
      },
      backgroundImage: {
        'mesh-admin': 'radial-gradient(at 0% 0%, rgba(79, 70, 229, 0.12) 0, transparent 50%), radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.08) 0, transparent 50%)',
        'mesh-viewer': 'radial-gradient(at 20% 20%, rgba(6, 182, 212, 0.15) 0, transparent 45%), radial-gradient(at 80% 80%, rgba(99, 102, 241, 0.1) 0, transparent 45%)',
      },
    },
  },
  plugins: [],
};
