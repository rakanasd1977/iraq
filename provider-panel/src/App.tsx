import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider, PageLoading } from '@rafidain/shared/ui';
import Layout from './Layout';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Categories = lazy(() => import('./pages/Categories'));
const Offers = lazy(() => import('./pages/Offers'));
const Orders = lazy(() => import('./pages/Orders'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Profile = lazy(() => import('./pages/Profile'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Coupons = lazy(() => import('./pages/Coupons'));
const Ratings = lazy(() => import('./pages/Ratings'));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading"><PageLoading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'provider') return <Navigate to="/login" replace />;
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
              <Route path="/catalog" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Catalog />
                </Suspense>
              } />
              <Route path="/categories" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Categories />
                </Suspense>
              } />
              <Route path="/offers" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Offers />
                </Suspense>
              } />
              <Route path="/orders" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Orders />
                </Suspense>
              } />
              <Route path="/bookings" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Bookings />
                </Suspense>
              } />
              <Route path="/wallet" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Wallet />
                </Suspense>
              } />
              <Route path="/profile" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Profile />
                </Suspense>
              } />
              <Route path="/promotions" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Promotions />
                </Suspense>
              } />
              <Route path="/coupons" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Coupons />
                </Suspense>
              } />
              <Route path="/ratings" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Ratings />
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
