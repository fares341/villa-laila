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
        lapis: { 50: '#eef1f8', 100: '#dce1ee', 200: '#b7c0da', 400: '#5a6a99', 600: '#2e3d66', 800: '#1e2a4a', 900: '#151d35' },
        pool: { 50: '#e9f5f4', 100: '#d3ecea', 300: '#7cc3bf', 600: '#2b8c8c', 700: '#21706f', 800: '#1a5756' },
        bloom: { 50: '#fbeef3', 100: '#f6dce6', 600: '#b83a6b', 700: '#962d56' },
        plaster: '#eef0e8',
        pistachio: '#d5e0c8',
        brass: '#c9a24a',
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        kufi: ['"El Messiri Variable"', '"Readex Pro Variable"', 'system-ui', 'sans-serif'],
        plex: ['"Readex Pro Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', '"Noto Sans Arabic Variable"', 'system-ui', 'sans-serif'],
        arabic: ['"Noto Sans Arabic Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
