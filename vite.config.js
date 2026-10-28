import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/iconicapp/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas em arquivos próprios: elas quase nunca mudam, então o
        // navegador as guarda em cache e, a cada atualização do Iconic, baixa
        // de novo só o código do app.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(recharts|d3-|victory-vendor|decimal\.js|es-toolkit)/.test(id)) return 'graficos'
          if (id.includes('node_modules/@supabase/')) return 'supabase'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
