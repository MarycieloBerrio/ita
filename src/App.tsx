import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Loading } from './components/Feedback';
import Layout from './components/Layout';
import LoginPage from './features/auth/LoginPage';
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
export default function App() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile) return <LoginPage />;
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="clientas" element={<ClientsPage />} />
            <Route path="clientas/:id" element={<ClientPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="visitas/:id" element={<VisitPage />} />
            <Route path="servicios" element={<CatalogPage />} />
            <Route path="inventario" element={<InventoryPage />} />
            <Route
              path="finanzas"
              element={profile.role === 'owner' ? <FinancePage /> : <Navigate to="/" replace />}
            />
            <Route path="ajustes" element={<SettingsPage />} />
            <Route path="cuenta" element={<PasswordPage />} />
            <Route path="recuperar" element={<PasswordPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
