import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

/**
 * 🛡️ Security Guard Component
 * Protects routes based on Authentication status and Role Authorization.
 */
const RequireAuth = ({ allowedRoles, children }) => {
    const { currentUser, userRole, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-slate-50">
                <Loader2 className="animate-spin text-blue-600" size={48} />
            </div>
        );
    }

    // 1. Authentication Check
    if (!currentUser) {
        // Redirect to login, but save the location they tried to access
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    // 2. Authorization Check (RBAC)
    // If allowedRoles is defined, check if user's role is in the list
    if (allowedRoles && !allowedRoles.includes(userRole)) {

        return <Navigate to="/unauthorized" replace />;
    }

    return children;
};

export default RequireAuth;
