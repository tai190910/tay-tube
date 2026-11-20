/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        yt: {
          bg: '#0b0b0b',
          sidebar: '#101010',
          card: '#161616',
          hover: '#222222',
          border: '#282828',
          red: '#e50914',
          redHover: '#c40812',
          text: '#f3f3f3',
          subtext: '#a3a3a3',
          active: '#333333',
        },
      },
    },
  },
  plugins: [],
};
