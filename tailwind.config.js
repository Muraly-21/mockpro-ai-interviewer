/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // Brand palette
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d7fe',
          300: '#a5bbfc',
          400: '#8197f8',
          500: '#6371f1',
          600: '#4f54e4',
          700: '#3f42c9',
          800: '#3538a3',
          900: '#303381',
          950: '#1e1f4e',
        },
        // Accent — cyber violet
        accent: {
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
        },
        // Surface shades for dark mode
        surface: {
          950: '#080810',
          900: '#0f0f1a',
          800: '#161625',
          700: '#1e1e32',
          600: '#282840',
        },
      },
      backgroundImage: {
        'hero-grid': "linear-gradient(rgba(99,113,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,113,241,0.06) 1px, transparent 1px)",
        'brand-gradient': 'linear-gradient(135deg, #6371f1 0%, #a855f7 100%)',
        'card-shine': 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 60%)',
      },
      backgroundSize: {
        'grid-sm': '40px 40px',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(99,113,241,0.3)' },
          '50%': { boxShadow: '0 0 25px rgba(99,113,241,0.6), 0 0 50px rgba(168,85,247,0.2)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      boxShadow: {
        'brand-sm': '0 2px 8px rgba(99,113,241,0.25)',
        'brand-md': '0 4px 20px rgba(99,113,241,0.35)',
        'brand-lg': '0 8px 40px rgba(99,113,241,0.4)',
        'glass': 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 24px rgba(0,0,0,0.4)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
