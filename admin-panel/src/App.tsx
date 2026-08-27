import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider, PageLoading } from '@rafidain/shared/ui';
import Layout from './Layout';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ExecutiveDashboard = lazy(() => import('./pages/ExecutiveDashboard'));
const Governorates = lazy(() => import('./pages/Governorates'));
const Districts = lazy(() => import('./pages/Districts'));
const Agents = lazy(() => import('./pages/Agents'));
const Services = lazy(() => import('./pages/Services'));
const Providers = lazy(() => import('./pages/Providers'));
const CatalogManager = lazy(() => import('./pages/CatalogManager'));
const CouponsManager = lazy(() => import('./pages/CouponsManager'));
const ReviewsManager = lazy(() => import('./pages/ReviewsManager'));
const NotificationSender = lazy(() => import('./pages/NotificationSender'));
const HomeLayout = lazy(() => import('./pages/HomeLayout'));
const Orders = lazy(() => import('./pages/Orders'));
const Customers = lazy(() => import('./pages/Customers'));
const Commissions = lazy(() => import('./pages/Commissions'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Wallets = lazy(() => import('./pages/Wallets'));
const AgentWithdrawals = lazy(() => import('./pages/AgentWithdrawals'));
const Leases = lazy(() => import('./pages/Leases'));
const Activity = lazy(() => import('./pages/Activity'));
const FinancialReport = lazy(() => import('./pages/FinancialReport'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Roles = lazy(() => import('./pages/Roles'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const BulkImportExport = lazy(() => import('./pages/BulkImportExport'));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading"><PageLoading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/login" replace />;
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
              <Route path="/executive" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <ExecutiveDashboard />
                </Suspense>
              } />
              <Route path="/governorates" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Governorates />
                </Suspense>
              } />
              <Route path="/districts" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Districts />
                </Suspense>
              } />
              <Route path="/agents" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Agents />
                </Suspense>
              } />
              <Route path="/services" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Services />
                </Suspense>
              } />
              <Route path="/catalog" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <CatalogManager />
                </Suspense>
              } />
              <Route path="/coupons" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <CouponsManager />
                </Suspense>
              } />
              <Route path="/reviews" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <ReviewsManager />
                </Suspense>
              } />
              <Route path="/notifications" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <NotificationSender />
                </Suspense>
              } />
              <Route path="/home-layout" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <HomeLayout />
                </Suspense>
              } />
              <Route path="/providers" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Providers />
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
              <Route path="/promotions" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Promotions />
                </Suspense>
              } />
              <Route path="/wallets" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Wallets />
                </Suspense>
              } />
              <Route path="/agent-withdrawals" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <AgentWithdrawals />
                </Suspense>
              } />
              <Route path="/leases" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Leases />
                </Suspense>
              } />
              <Route path="/activity" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Activity />
                </Suspense>
              } />
              <Route path="/financial-report" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <FinancialReport />
                </Suspense>
              } />
              <Route path="/settings" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Settings />
                </Suspense>
              } />
              <Route path="/roles" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Roles />
                </Suspense>
              } />
              <Route path="/admin-users" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <AdminUsers />
                </Suspense>
              } />
              <Route path="/bulk" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <BulkImportExport />
                </Suspense>
              } />
              <Route path="/profile" element={
                <Suspense fallback={<div className="page-loading"><PageLoading /></div>}>
                  <Profile />
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
