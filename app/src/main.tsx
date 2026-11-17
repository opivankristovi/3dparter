import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { App } from './app/App'
import { requestPersistence } from './data/projects'
import { seedIfFirstRun } from './data/seed'

// Ask the browser not to evict our projects, then add the sample on first run.
// A storage failure must not stop the app from drawing.
requestPersistence()
const ready = seedIfFirstRun().catch(() => {})

void ready.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
