import { createRoot } from 'react-dom/client'
import { EmbedApp } from './EmbedApp.js'
import './index.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<EmbedApp />)
}
