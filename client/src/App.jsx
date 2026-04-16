import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import RequireAuth from './components/auth/RequireAuth';
import ErrorBoundary from './components/shared/ErrorBoundary';
import PageLoader from './components/shared/PageLoader';
import { ROLES } from './config/roles';

const Landing = lazy(() => import('./pages/public/Landing'));
const Login = lazy(() => import('./pages/public/Login'));
const Authentication = lazy(() => import('./pages/public/Authentication'));
const ChangePassword = lazy(() => import('./pages/public/ChangePassword'));
const ForgotPassword = lazy(() => import('./pages/public/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/public/ResetPassword'));
const Unauthorized = lazy(() => import('./pages/public/Unauthorized'));
const NotFound = lazy(() => import('./pages/public/NotFound'));

const MisDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AccountManagement = lazy(() => import('./pages/admin/AccountManagement'));
const MisSettings = lazy(() => import('./pages/admin/Settings'));
const MisAuditTrails = lazy(() => import('./pages/admin/AuditTrails'));

const HcsdDashboard = lazy(() => import('./pages/hcsd/HcsdDashboard'));
const StaffManagement = lazy(() => import('./pages/hcsd/StaffManagement'));
const ProjectRegistry = lazy(() => import('./pages/hcsd/ProjectRegistry'));
const AuditTrails = lazy(() => import('./pages/hcsd/AuditTrails'));
const Notifications = lazy(() => import('./pages/hcsd/Notifications'));
const CreateProject = lazy(() => import('./pages/hcsd/CreateProject'));
const ProjectDetail = lazy(() => import('./pages/hcsd/ProjectDetail'));
const Settings = lazy(() => import('./pages/hcsd/Settings'));

const MayorDashboard = lazy(() => import('./pages/mayor/MayorDashboard'));

const CpdoDashboard = lazy(() => import('./pages/cpdo/CpdoDashboard'));

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/verify-identity" element={<Authentication />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/unauthorized" element={<Unauthorized />} />

                <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />

                <Route path="/admin/dashboard" element={<RequireAuth allowedRoles={[ROLES.MIS]}><MisDashboard /></RequireAuth>} />
                <Route path="/admin/accounts" element={<RequireAuth allowedRoles={[ROLES.MIS]}><AccountManagement /></RequireAuth>} />
                <Route path="/admin/settings" element={<RequireAuth allowedRoles={[ROLES.MIS]}><MisSettings /></RequireAuth>} />
                <Route path="/admin/audits" element={<RequireAuth allowedRoles={[ROLES.MIS]}><MisAuditTrails /></RequireAuth>} />

                <Route path="/mayor/dashboard" element={<RequireAuth allowedRoles={[ROLES.MAYOR]}><MayorDashboard /></RequireAuth>} />

                <Route path="/hcsd/dashboard" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><HcsdDashboard /></RequireAuth>} />
                <Route path="/hcsd/staff" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><StaffManagement /></RequireAuth>} />
                <Route path="/hcsd/projects" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><ProjectRegistry /></RequireAuth>} />
                <Route path="/hcsd/projects/:id" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><ProjectDetail /></RequireAuth>} />
                <Route path="/hcsd/audits" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><AuditTrails /></RequireAuth>} />
                <Route path="/hcsd/notifications" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><Notifications /></RequireAuth>} />
                <Route path="/hcsd/create-project" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><CreateProject /></RequireAuth>} />
                <Route path="/hcsd/settings" element={<RequireAuth allowedRoles={[ROLES.HCSD]}><Settings /></RequireAuth>} />

                <Route path="/cpdo/dashboard" element={<RequireAuth allowedRoles={[ROLES.CPDO]}><CpdoDashboard /></RequireAuth>} />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;