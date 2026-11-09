import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HealthGate } from './components/HealthGate';
import { Layout } from './components/Layout';
import { RequireAuth, RequirePermission } from './components/guards';
import { Splash } from './components/ui';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import RegisterPage from './pages/RegisterPage';

// Fuera del bundle inicial: se descargan al entrar a cada ruta.
const EstadoPage = lazy(() => import('./pages/EstadoPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const RefinePage = lazy(() => import('./pages/RefinePage'));

export default function App() {
  return (
    <ErrorBoundary>
      <HealthGate>
        <AuthProvider>
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Navigate to="/files" replace />} />
                  <Route path="/estado" element={<EstadoPage />} />
                  <Route element={<RequirePermission permission="files:read" />}>
                    <Route path="/files" element={<FilesPage />} />
                    <Route path="/files/:id/refine" element={<RefinePage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </HealthGate>
    </ErrorBoundary>
  );
}
