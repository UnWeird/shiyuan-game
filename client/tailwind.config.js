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
        // 古风配色
        imperial: {
          red: '#8B1A1A',
          'red-light': '#C0392B',
          gold: '#C9A227',
          'gold-light': '#E8C84A',
          'gold-dark': '#8B6914',
          ink: '#0D0D0D',
          'ink-light': '#1A1209',
          parchment: '#F5E6C8',
          'parchment-dark': '#D4B896',
          jade: '#2E6B4F',
          // 深底上的青玉强调色（jade 本身太暗，深色背景上读不出来）
          'jade-light': '#6FCFA4',
        },
      },
      fontFamily: {
        ancient: ['"Ma Shan Zheng"', '"Noto Serif SC"', 'serif'],
        chinese: ['"Noto Serif SC"', 'serif'],
      },
      backgroundImage: {
        'ancient-pattern': "repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(201,162,39,0.03) 20px, rgba(201,162,39,0.03) 21px), repeating-linear-gradient(-45deg, transparent, transparent 20px, rgba(201,162,39,0.03) 20px, rgba(201,162,39,0.03) 21px)",
      },
      boxShadow: {
        'gold': '0 0 20px rgba(201,162,39,0.3), 0 0 40px rgba(201,162,39,0.1)',
        'gold-sm': '0 0 8px rgba(201,162,39,0.4)',
        'imperial': 'inset 0 1px 0 rgba(201,162,39,0.2), 0 4px 15px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
}
