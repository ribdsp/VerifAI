import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createApiClient } from './lib/api'
import { takeSessionToken } from './lib/session'
import './styles.css'

// Before anything renders, so the token is out of the address bar at once.
const token = takeSessionToken(window.location, window.history)
const client = createApiClient({ fetch: (input, init) => fetch(input, init) })

const root = document.getElementById('root')
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App client={client} hasSession={token !== undefined} />
    </StrictMode>,
  )
}
