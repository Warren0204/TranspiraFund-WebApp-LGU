/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      keyframes: {
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'    },
        },
        shimmer: {
          '0%':   { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)'    },
          '50%':       { opacity: '1',   transform: 'scale(1.12)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        donutDraw: {
          '0%':   { strokeDasharray: '0 1000' },
          '100%': { strokeDasharray: 'var(--dash-len) 1000' },
        },
      },
      animation: {
        'slide-up':   'slideUp 0.5s ease-out both',
        'shimmer':    'shimmer 2.5s linear infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'fade-in':    'fadeIn 0.4s ease-out both',
      },
    },
  },
  plugins: [],
}
