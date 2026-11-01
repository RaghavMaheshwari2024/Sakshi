/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Asphalt: every surface. Bone: every piece of text. Paint: the one accent.
        asphalt: {
          950: '#0a0b0c',
          900: '#0f1012',
          850: '#141517',
          800: '#1a1b1e',
          700: '#242529',
          600: '#34353a',
        },
        bone: {
          DEFAULT: '#edeae3',
          200: '#d3d0c8',
          300: '#b4b1a9',
          400: '#99978f',
          500: '#85837c',
        },
        paint: {
          DEFAULT: '#f2c037',
          soft: 'rgba(242, 192, 55, 0.12)',
        },
        // Signal colours mean something; they are never decoration.
        signal: {
          red: '#ef5a4c',
          amber: '#f0a63a',
          green: '#4fbf8b',
          redsoft: 'rgba(239, 90, 76, 0.12)',
          amberSoft: 'rgba(240, 166, 58, 0.12)',
          greensoft: 'rgba(79, 191, 139, 0.12)',
        },
        line: {
          DEFAULT: 'rgba(237, 234, 227, 0.09)',
          strong: 'rgba(237, 234, 227, 0.17)',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Devanagari"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        serif: ['"IBM Plex Serif"', '"IBM Plex Sans Devanagari"', 'Georgia', 'serif'],
      },
      fontSize: {
        micro: ['10.5px', { lineHeight: '14px', letterSpacing: '0.07em' }],
      },
      borderRadius: {
        DEFAULT: '5px',
      },
      maxWidth: {
        page: '1180px',
      },
      height: {
        bar: '52px',
      },
    },
  },
  plugins: [],
};
