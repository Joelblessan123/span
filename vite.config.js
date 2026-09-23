import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  return {
  publicDir: 'assets',
  plugins: [
    react(),
    // Plugin to inject environment variables for vanilla JS modules
    {
      name: 'inject-env-vars',
      transformIndexHtml(html) {
        // Check if window.__ENV__ already exists to prevent duplicates
        if (html.includes('window.__ENV__')) {
          // Just add data-cfasync="false" to module scripts
          return html.replace(
            /<script type="module"([^>]*)src="([^"]*)"([^>]*)>/g,
            '<script type="module"$1src="$2"$3 data-cfasync="false">'
          )
        }
        
        // Inject env vars as a global variable for vanilla JS files
        const envScript = `
          <script>
            window.__ENV__ = {
              VITE_SUPABASE_URL: ${JSON.stringify(env.VITE_SUPABASE_URL || '')},
              VITE_SUPABASE_ANON_KEY: ${JSON.stringify(env.VITE_SUPABASE_ANON_KEY || '')}
            };
          </script>
        `
        // Add data-cfasync="false" to module scripts to disable Cloudflare Rocket Loader
        let modified = html.replace('</head>', `${envScript}</head>`)
        modified = modified.replace(
          /<script type="module"([^>]*)src="([^"]*)"([^>]*)>/g,
          '<script type="module"$1src="$2"$3 data-cfasync="false">'
        )
        return modified
      }
    }
  ],
  base: '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB (optional)
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true
      }
    },
    rollupOptions: {
      input: {
        main: './index.html',
        bills: './bills.html',
        blog: './blog.html',
        'blog-post': './blog-post.html',
        directory: './directory.html',
        'our-story': './our-story.html',
        login: './login.html',
        dashboard: './dashboard.html',
        'classroom/join': './classroom/join.html',
        'classroom/dashboard': './classroom/dashboard.html',
        'mentor-join': './mentor-join.html',
        '404': './404.html',
      },
      output: {
        manualChunks: {
          // Use object syntax for more reliable chunking
          // React must be in a single chunk and loaded first
          'react-vendor': ['react', 'react-dom'],
          'supabase': ['@supabase/supabase-js'],
          'pdf-vendor': ['pdfjs-dist', 'react-pdf'],
          'ai-detector': ['@huggingface/transformers'],
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      }
    },
    // Ensure proper module resolution
    resolve: {
      dedupe: ['react', 'react-dom']
    }
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
}
})

