import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { UnsavedChangesProvider } from './lib/useUnsavedChanges';
import { Loading } from './components/Feedback';
import RouteError from './components/RouteError';
import Layout from './components/Layout';
import LoginPage from './features/auth/LoginPage';
import PrivacyPolicyPage from './features/privacy/PrivacyPolicyPage';
const HomePage = lazy(() => import('./features/home/HomePage'));
const ClientsPage = lazy(() => import('./features/clients/ClientsPage'));
const ClientPage = lazy(() => import('./features/clients/ClientPage'));
const AgendaPage = lazy(() => import('./features/agenda/AgendaPage'));
const VisitPage = lazy(() => import('./features/visits/VisitPage'));
const CatalogPage = lazy(() => import('./features/catalog/CatalogPage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const FinancePage = lazy(() => import('./features/finance/FinancePage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const PasswordPage = lazy(() => import('./features/auth/PasswordPage'));

function Root() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}
function OwnerOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  return profile?.role === 'owner' ? children : <Navigate to="/" replace />;
}
const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Layout />,
        children: [
          {
            // Keeps the navigation shell visible while a page loads or when one page fails.
            element: (
              <Suspense fallback={<Loading />}>
                <Outlet />
              </Suspense>
            ),
            errorElement: <RouteError />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'clientas', element: <ClientsPage /> },
              { path: 'clientas/:id', element: <ClientPage /> },
              { path: 'agenda', element: <AgendaPage /> },
              { path: 'visitas/:id', element: <VisitPage /> },
              { path: 'servicios', element: <CatalogPage /> },
              { path: 'inventario', element: <InventoryPage /> },
              {
                path: 'finanzas',
                element: (
                  <OwnerOnly>
                    <FinancePage />
                  </OwnerOnly>
                ),
              },
              { path: 'ajustes', element: <SettingsPage /> },
              { path: 'cuenta', element: <PasswordPage /> },
              { path: 'recuperar', element: <PasswordPage /> },
              { path: '*', element: <Navigate to="/" replace /> },
            ],
          },
        ],
      },
    ],
  },
];

// Created lazily and once: the router subscribes to history as soon as it exists.
let router: ReturnType<typeof createBrowserRouter> | undefined;
function PrivateApp() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile) return <LoginPage />;
  router ??= createBrowserRouter(routes);
  return <RouterProvider router={router} />;
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/privacidad') return <PrivacyPolicyPage />;
  return <PrivateApp />;
}
