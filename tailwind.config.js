/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F14',
        panel: '#121821',
        line: '#1E2A36',
        truth: '#10B981',
        suspect: '#F59E0B',
        pruned: '#4B5563',
        ink: '#E6EDF3',
        'ink-muted': '#8A9AA8',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['PingFang SC', 'Microsoft YaHei', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

