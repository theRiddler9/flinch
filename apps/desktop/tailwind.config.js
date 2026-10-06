/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./ui/index.html",
    "./ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        flinch: {
          deep:    '#1a1a1a',
          base:    '#222222',
          panel:   '#2d2d2d',
          surface: '#383838',
          hover:   '#474747',
          border:  '#3a3a3a',
          'border-dim': '#2e2e2e',
          text:    '#e8e8e8',
          'text-dim':   '#9a9a9a',
          'text-muted': '#6a6a6a',
          accent:  '#4e8cff',
          'accent-dim': '#3a6fd0',
          success: '#48c78e',
          error:   '#f14668',
          warning: '#ffb84d',
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'flinch-glow': '0 0 12px rgba(78, 140, 255, 0.15)',
        'flinch-panel': '0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.03)',
      },
      animation: {
        'flinch-pulse': 'flinch-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flinch-slide': 'flinch-slide-in 200ms ease-out both',
        'flinch-fade':  'flinch-fade-in 200ms ease-out both',
      }
    },
  },
  plugins: [],
}
