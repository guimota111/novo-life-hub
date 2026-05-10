import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        tamagochi: {
          950: '#0b0f16',
          900: '#131a26',
          800: '#1d2639',
          700: '#27304d',
          500: '#6d8cff',
          400: '#7cd5ff',
          300: '#ffd166',
          200: '#ff8fb3',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.08), 0 15px 40px rgba(96,123,255,0.16)',
      },
    },
  },
  plugins: [],
};

export default config;
