import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the app. The page's security policy allows no outside hosts.
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles.css'
import App from './App.tsx'
import { start } from './state/store.ts'

start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
