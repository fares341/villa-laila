import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        clay: { 50: '#fbf6f0', 100: '#f4e8d9', 200: '#e8cfb0', 300: '#d9ac7e', 400: '#c98857', 500: '#b66a3b', 600: '#9a5330', 700: '#7b4128', 800: '#5f3323', 900: '#3d2218' },
        olive: { 50: '#f5f6ef', 100: '#e6e9d4', 200: '#ccd3a8', 300: '#aab677', 400: '#869553', 500: '#677638', 600: '#505d2c', 700: '#3e4824', 800: '#30381f', 900: '#1f2514' },
        sand: '#f7f1e8',
        // Villa Layla v2: Cairo street-sign lapis, pool-tile turquoise, bougainvillea, lime-washed plaster
        // Brand palette (cocoa from the key logo). Kept under the old 'lapis' name so every existing page restyles at once.
        lapis: { 50: '#FBF7F1', 100: '#ECE2D4', 200: '#D9CBB6', 400: '#A88762', 600: '#6B4A30', 800: '#4A3222', 900: '#2F2925' },
        pool: { 50: '#e9f5f4', 100: '#d3ecea', 300: '#7cc3bf', 600: '#2b8c8c', 700: '#21706f', 800: '#1a5756' },
        bloom: { 50: '#FBF1EA', 100: '#F5E1D2', 600: '#9C4A1E', 700: '#7E3A16' },
        plaster: '#eef0e8',
        pistachio: '#d5e0c8',
        brass: '#D29A45',
        cocoa: { 50: '#FBF7F1', 100: '#F4ECE0', 200: '#ECE2D4', 400: '#A88762', 600: '#6B4A30', 800: '#4A3222', 900: '#2F2925' },
        gold: { 300: '#E9C27E', 500: '#D29A45', 600: '#BF8634' },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', '"Almarai"', 'system-ui', 'sans-serif'],
        kufi: ['"El Messiri Variable"', '"Readex Pro Variable"', 'system-ui', 'sans-serif'],
        plex: ['"Readex Pro Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', '"Almarai"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        arabic: ['"Noto Sans Arabic Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
