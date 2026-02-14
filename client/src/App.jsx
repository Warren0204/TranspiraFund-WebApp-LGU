import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import RequireAuth from './components/auth/RequireAuth';
import { Loader2 } from 'lucide-react';

// --- CONFIG ---
import { ROLES } from './config/roles';

// --- LAZY LOADED PAGES (Performance A: Code Splitting) ---
const Landing = lazy(() => import('./pages/public/Landing'));
const Login = lazy(() => import('./pages/public/Login'));
const Authentication = lazy(() => import('./pages/public/Authentication'));

// Admin (MIS)
const MisDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AccountManagement = lazy(() => import('./pages/admin/AccountManagement'));

// DEPW routes
const MayorDashboard = () => <div className="p-10 text-2xl font-bold text-slate-700">Mayor's Office Dashboard</div>;
const DepwDashboard = lazy(() => import('./pages/depw/DepwDashboard'));
const StaffManagement = lazy(() => import('./pages/depw/StaffManagement'));
const ProjectRegistry = lazy(() => import('./pages/depw/ProjectRegistry'));
const AuditTrails = lazy(() => import('./pages/depw/AuditTrails'));
const Notifications = lazy(() => import('./pages/depw/Notifications'));
const CreateProject = lazy(() => import('./pages/depw/CreateProject'));
const Settings = lazy(() => import('./pages/depw/Settings'));

// CPDO Dashboard
const CpdoDashboard = () => <div className="p-10 text-2xl font-bold text-slate-700">City Planning (CPDO) Dashboard</div>;

// Error Pages
const Unauthorized = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 text-red-600 font-bold">
    403 - Access Denied (Unauthorized Role)
  </div>
);

const NotFound = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 font-bold">
    404 - Page Not Found
  </div>
);

// Loading Fallback
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <Loader2 className="animate-spin text-blue-600" size={40} />
  </div>
);

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* --- PUBLIC ROUTES --- */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify-identity" element={<Authentication />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* --- PROTECTED ROUTES (Security A: RBAC Enforced) --- */}

            {/* 1. MIS ADMIN routes */}
            <Route element={<RequireAuth allowedRoles={[ROLES.MIS]}><MisDashboard /></RequireAuth>} path="/admin/dashboard" />
            <Route element={<RequireAuth allowedRoles={[ROLES.MIS]}><AccountManagement /></RequireAuth>} path="/admin/accounts" />

            {/* 2. MAYOR routes */}
            <Route element={<RequireAuth allowedRoles={[ROLES.MAYOR]}><MayorDashboard /></RequireAuth>} path="/mayor/dashboard" />

            {/* 3. DEPW routes */}
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><DepwDashboard /></RequireAuth>} path="/depw/dashboard" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><StaffManagement /></RequireAuth>} path="/depw/staff" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><ProjectRegistry /></RequireAuth>} path="/depw/projects" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><AuditTrails /></RequireAuth>} path="/depw/audits" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><Notifications /></RequireAuth>} path="/depw/notifications" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><CreateProject /></RequireAuth>} path="/depw/create-project" />
            <Route element={<RequireAuth allowedRoles={[ROLES.DEPW]}><Settings /></RequireAuth>} path="/depw/settings" />

            {/* 4. CPDO routes */}
            <Route element={<RequireAuth allowedRoles={[ROLES.CPDO]}><CpdoDashboard /></RequireAuth>} path="/cpdo/dashboard" />

            {/* Fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;