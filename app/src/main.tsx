import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { DesignPage } from './design/DesignPage'

// TODO: the real app shell comes later. Until then the design page renders for
// every route; `#design` is the canonical address and stays valid after the shell lands.
const showDesign = location.hash === '#design' || true

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showDesign ? <DesignPage /> : null}</StrictMode>,
)
