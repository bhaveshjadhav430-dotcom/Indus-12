/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        indus: {
          orange: '#E8611A',
          'orange-dark': '#C0501A',
          'orange-light': '#F47C3C',
          grey: '#3A3A3A',
          'grey-mid': '#6B6B6B',
          'grey-light': '#F2F0EE',
          charcoal: '#1A1A1A',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
