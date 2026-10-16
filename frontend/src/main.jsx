import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startAppUpdateChecks } from './utils/appUpdates.js'

// Vite replaces this build-time constant with the matching manifest identifier.
/* global __APP_BUILD_ID__ */
if (import.meta.env.PROD) startAppUpdateChecks(__APP_BUILD_ID__)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
