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
          deep:    'var(--flinch-bg-deep)',
          base:    'var(--flinch-bg-base)',
          panel:   'var(--flinch-bg-panel)',
          surface: 'var(--flinch-bg-surface)',
          hover:   'var(--flinch-bg-hover)',
          border:  'var(--flinch-border)',
          'border-dim': 'var(--flinch-border-dim)',
          text:    'var(--flinch-text)',
          'text-dim':   'var(--flinch-text-dim)',
          'text-muted': 'var(--flinch-text-muted)',
          accent:  'var(--flinch-accent)',
          'accent-dim': 'var(--flinch-accent-dim)',
          success: 'var(--flinch-success)',
          error:   'var(--flinch-error)',
          warning: 'var(--flinch-warning)',
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
