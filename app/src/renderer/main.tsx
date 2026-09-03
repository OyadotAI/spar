import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'   // self-hosted: the CSP is font-src 'self' data:
import './theme.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
