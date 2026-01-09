/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#FFD700',
          light: '#FFF4B8',
          dark: '#B8860B',
        },
        silver: {
          DEFAULT: '#C0C0C0',
          light: '#E8E8E8',
          dark: '#808080',
        },
        bronze: {
          DEFAULT: '#CD7F32',
          light: '#E6A85C',
          dark: '#8B4513',
        },
      },
    },
  },
  plugins: [],
}
