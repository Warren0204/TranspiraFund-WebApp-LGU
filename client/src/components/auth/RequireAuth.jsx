import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

const RequireAuth = ({ allowedRoles, children }) => {
    const { currentUser, userRole, otpVerified, mustChangePassword, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-slate-50">
                <Loader2 className="animate-spin text-blue-600" size={48} />
            </div>
        );
    }

    if (!currentUser) {
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    if (!otpVerified) {
        return (
            <Navigate
                to="/verify-identity"
                state={{ email: currentUser.email, targetPath: location.pathname }}
                replace
            />
        );
    }

    if (mustChangePassword && location.pathname !== "/change-password") {
        return <Navigate to="/change-password" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(userRole)) {
        return <Navigate to="/unauthorized" replace />;
    }

    return children;
};

export default RequireAuth;
