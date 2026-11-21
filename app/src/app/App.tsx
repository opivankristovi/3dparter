import { lazy, Suspense, useEffect } from 'react'
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { DesignPage } from '../design/DesignPage'
import { Dashboard } from '../screens/Dashboard'
import { Landing } from '../screens/Landing'
import { Login } from '../screens/Login'
import { NotFound } from '../screens/NotFound'
import { WorkspaceRoute } from '../screens/Workspace'
import { ErrorBoundary } from '../support/ErrorBoundary'
import { installErrorCapture } from '../support/errorLog'
import { ToastProvider } from '../ui/Toast'
import { TooltipProvider } from '../ui/Tooltip'
import { useSettings, useThemeSync } from './useSettings'

const Privacy = lazy(() => import('../screens/Privacy'))
const Support = lazy(() => import('../screens/Support'))

export function App() {
  const ready = useSettings((s) => s.ready)
  const init = useSettings((s) => s.init)
  useThemeSync()
  useEffect(() => installErrorCapture(), [])
  useEffect(() => {
    void init()
  }, [init])

  return (
    <ErrorBoundary>
    <TooltipProvider>
      <ToastProvider>
        {ready ? (
          <Router hook={useHashLocation}>
            <Suspense fallback={null}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/p/:id" component={WorkspaceRoute} />
              <Route path="/design" component={DesignPage} />
              <Route path="/login" component={Login} />
              <Route path="/welcome" component={Landing} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/support" component={Support} />
              <Route>
                <NotFound />
              </Route>
            </Switch>
            </Suspense>
          </Router>
        ) : null}
      </ToastProvider>
    </TooltipProvider>
    </ErrorBoundary>
  )
}
