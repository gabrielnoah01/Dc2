/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Escala fria e levemente azulada: dá profundidade sem virar cinza morto.
        ink: {
          950: '#08090d',
          900: '#0d0e13',
          800: '#14161d',
          700: '#1b1e27',
          600: '#242835',
          500: '#2f3441',
          400: '#3d4354',
        },
        accent: {
          DEFAULT: '#5b8cff',
          hover: '#7aa2ff',
          dim: '#3f6ae0',
          soft: '#5b8cff22',
          glow: '#5b8cff55',
        },
        speak: '#3fd68c',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Sombras com cor da base, não pretas: pretas sujam fundo escuro.
        card: '0 1px 2px rgba(0,0,0,.4), 0 8px 24px -8px rgba(0,0,0,.5)',
        pop: '0 4px 12px rgba(0,0,0,.5), 0 16px 48px -12px rgba(0,0,0,.6)',
        glow: '0 0 0 1px rgba(91,140,255,.35), 0 0 24px -4px rgba(91,140,255,.45)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Anel de quem está falando: pulso contínuo e discreto.
        'ring-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(63,214,140,.45)' },
          '50%': { boxShadow: '0 0 0 5px rgba(63,214,140,0)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        breathe: {
          '0%, 100%': { opacity: '.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out both',
        'fade-up': 'fade-up .28s cubic-bezier(.22,1,.36,1) both',
        'pop-in': 'pop-in .2s cubic-bezier(.22,1,.36,1) both',
        'slide-down': 'slide-down .16s cubic-bezier(.22,1,.36,1) both',
        'ring-pulse': 'ring-pulse 1.6s ease-out infinite',
        'spin-slow': 'spin-slow 1.1s linear infinite',
        shimmer: 'shimmer 1.6s infinite',
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
