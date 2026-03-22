import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        ink: {
          DEFAULT: '#1b1b1f',
          muted: '#4b4b57',
        },
        snow: '#f7f6f3',
        spruce: '#0c3b2e',
        pine: '#115e45',
        maple: '#d97706',
        sky: '#d8f1ff',
        slate: '#0f172a',
      },
      boxShadow: {
        soft: '0 10px 35px rgba(15, 23, 42, 0.12)',
        lift: '0 20px 60px rgba(15, 23, 42, 0.18)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
