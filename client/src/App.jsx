import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/auth/RequireAuth';
import PageLoader from './components/shared/PageLoader';
import { ROLES } from './config/roles';

// --- LAZY LOADED PAGES (Code Splitting) ---

// Public
const Landing = lazy(() => import('./pages/public/Landing'));
const Login = lazy(() => import('./pages/public/Login'));
const Authentication = lazy(() => import('./pages/public/Authentication'));
const Unauthorized = lazy(() => import('./pages/public/Unauthorized'));
const NotFound = lazy(() => import('./pages/public/NotFound'));

// Admin (MIS)
const MisDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AccountManagement = lazy(() => import('./pages/admin/AccountManagement'));

// DEPW
const DepwDashboard = lazy(() => import('./pages/depw/DepwDashboard'));
const StaffManagement = lazy(() => import('./pages/depw/StaffManagement'));
const ProjectRegistry = lazy(() => import('./pages/depw/ProjectRegistry'));
const AuditTrails = lazy(() => import('./pages/depw/AuditTrails'));
const Notifications = lazy(() => import('./pages/depw/Notifications'));
const CreateProject = lazy(() => import('./pages/depw/CreateProject'));
const Settings = lazy(() => import('./pages/depw/Settings'));

// Mayor
const MayorDashboard = lazy(() => import('./pages/mayor/MayorDashboard'));

// CPDO
const CpdoDashboard = lazy(() => import('./pages/cpdo/CpdoDashboard'));

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify-identity" element={<Authentication />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* MIS Admin Routes */}
            <Route path="/admin/dashboard" element={<RequireAuth allowedRoles={[ROLES.MIS]}><MisDashboard /></RequireAuth>} />
            <Route path="/admin/accounts" element={<RequireAuth allowedRoles={[ROLES.MIS]}><AccountManagement /></RequireAuth>} />

            {/* Mayor Routes */}
            <Route path="/mayor/dashboard" element={<RequireAuth allowedRoles={[ROLES.MAYOR]}><MayorDashboard /></RequireAuth>} />

            {/* DEPW Routes */}
            <Route path="/depw/dashboard" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><DepwDashboard /></RequireAuth>} />
            <Route path="/depw/staff" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><StaffManagement /></RequireAuth>} />
            <Route path="/depw/projects" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><ProjectRegistry /></RequireAuth>} />
            <Route path="/depw/audits" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><AuditTrails /></RequireAuth>} />
            <Route path="/depw/notifications" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><Notifications /></RequireAuth>} />
            <Route path="/depw/create-project" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><CreateProject /></RequireAuth>} />
            <Route path="/depw/settings" element={<RequireAuth allowedRoles={[ROLES.DEPW]}><Settings /></RequireAuth>} />

            {/* CPDO Routes */}
            <Route path="/cpdo/dashboard" element={<RequireAuth allowedRoles={[ROLES.CPDO]}><CpdoDashboard /></RequireAuth>} />

            {/* Fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;