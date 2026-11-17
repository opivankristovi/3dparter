import { useEffect } from 'react'
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { DesignPage } from '../design/DesignPage'
import { Dashboard } from '../screens/Dashboard'
import { Login } from '../screens/Login'
import { NotFound } from '../screens/NotFound'
import { WorkspaceRoute } from '../screens/Workspace'
import { ToastProvider } from '../ui/Toast'
import { TooltipProvider } from '../ui/Tooltip'
import { useSettings, useThemeSync } from './useSettings'

export function App() {
  const ready = useSettings((s) => s.ready)
  const init = useSettings((s) => s.init)
  useThemeSync()
  useEffect(() => {
    void init()
  }, [init])

  return (
    <TooltipProvider>
      <ToastProvider>
        {ready ? (
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/p/:id" component={WorkspaceRoute} />
              <Route path="/design" component={DesignPage} />
              <Route path="/login" component={Login} />
              <Route>
                <NotFound />
              </Route>
            </Switch>
          </Router>
        ) : null}
      </ToastProvider>
    </TooltipProvider>
  )
}
