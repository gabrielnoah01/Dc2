/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0d0e12',
          800: '#14161c',
          700: '#1b1e26',
          600: '#242833',
          500: '#2f3441',
        },
        accent: {
          DEFAULT: '#5b8cff',
          hover: '#7aa2ff',
          soft: '#5b8cff22',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
