import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider, PageLoading } from '@rafidain/shared/ui';
import Layout from './Layout';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Providers = lazy(() => import('./pages/Providers'));
const ProviderDetail = lazy(() => import('./pages/ProviderDetail'));
const Orders = lazy(() => import('./pages/Orders'));
const Customers = lazy(() => import('./pages/Customers'));
const Commissions = lazy(() => import('./pages/Commissions'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Lease = lazy(() => import('./pages/Lease'));
const Profile = lazy(() => import('./pages/Profile'));
const Activity = lazy(() => import('./pages/Activity'));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading"><PageLoading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'agent') return <Navigate to="/login" replace />;
  return <Layout />;
}

function Public() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading"><PageLoading /></div>;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Public />} />
            <Route element={<Protected />}>
              <Route path="/" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Dashboard />
                </Suspense>
              } />
              <Route path="/providers" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Providers />
                </Suspense>
              } />
              <Route path="/providers/:id" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <ProviderDetail />
                </Suspense>
              } />
              <Route path="/orders" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Orders />
                </Suspense>
              } />
              <Route path="/customers" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Customers />
                </Suspense>
              } />
              <Route path="/commissions" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Commissions />
                </Suspense>
              } />
              <Route path="/wallet" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Wallet />
                </Suspense>
              } />
              <Route path="/lease" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Lease />
                </Suspense>
              } />
              <Route path="/profile" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Profile />
                </Suspense>
              } />
              <Route path="/activity" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Activity />
                </Suspense>
              } />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
