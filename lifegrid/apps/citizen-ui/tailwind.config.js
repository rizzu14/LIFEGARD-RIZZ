/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#f5f5f5',
          2: '#eeeeee',
          3: '#e5e5e5',
        },
        border: {
          DEFAULT: '#dddddd',
          2: '#cccccc',
        },
        critical: '#e53935',
        high:     '#f57c00',
        medium:   '#f9a825',
        low:      '#2e7d32',
        info:     '#1565c0',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
        sans: ['Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
