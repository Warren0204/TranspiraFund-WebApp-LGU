import React, { memo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ShieldCheck, LayoutDashboard, Users, LogOut, Menu, X
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import logo from '../../assets/logo.png';
import LogoutModal from '../shared/LogoutModal';


const AdminSidebar = memo(() => {
    const navigate = useNavigate();
    const location = useLocation();
    const currentPath = location.pathname;

    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    // Close mobile sidebar on route change
    React.useEffect(() => {
        setIsMobileOpen(false);
    }, [location.pathname]);

    const isActive = (path) => currentPath === path
        ? "bg-blue-50 text-blue-700 font-semibold"
        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 font-medium";

    const handleConfirmLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try {
            // Securely sign out from Firebase
            await signOut(auth);
            // Navigate to Landing Page (Root)
            navigate('/');
        } catch (error) {

            setIsLoggingOut(false);
        }
    };

    return (
        <>
            {/* MOBILE MENU BUTTON - Fixed Top Left */}
            <button
                onClick={() => setIsMobileOpen(true)}
                className="fixed top-4 left-4 z-20 p-2 bg-white rounded-lg shadow-md md:hidden text-slate-600 hover:text-blue-600 transition-colors"
                aria-label="Open Menu"
            >
                <Menu size={24} />
            </button>

            {/* OVERLAY - Mobile Only */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-30 md:hidden animate-in fade-in duration-200"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            <aside className={`w-72 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 transition-transform duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                {/* CLOSE BUTTON - Mobile Only */}
                <button
                    onClick={() => setIsMobileOpen(false)}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 md:hidden"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>
                <div className="p-6 flex items-center gap-3">
                    <div className="bg-white p-0.5 rounded-full shadow-lg shadow-blue-600/10 border border-slate-100 overflow-hidden w-10 h-10 flex items-center justify-center">
                        <img src={logo} alt="Logo" className="w-full h-full rounded-full object-cover" />
                    </div>
                    <div>
                        <h1 className="font-bold text-slate-900 leading-tight">TranspiraFund</h1>
                        <p className="text-[10px] font-bold text-blue-600 tracking-wider uppercase">MIS</p>
                    </div>
                </div>

                <nav className="flex-1 px-4 mt-6 space-y-1">
                    <p className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Navigation</p>
                    <button
                        onClick={() => navigate('/admin/dashboard')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isActive('/admin/dashboard')}`}
                    >
                        <LayoutDashboard size={20} />
                        Dashboard
                    </button>
                    <button
                        onClick={() => navigate('/admin/accounts')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isActive('/admin/accounts')}`}
                    >
                        <Users size={20} />
                        Account Management
                    </button>
                </nav>

                <div className="p-4 border-t border-slate-100">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-3">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs relative">
                                S <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></span>
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-900">System Admin</p>
                                <p className="text-[10px] font-bold text-blue-600 uppercase">IT Operations</p>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowLogoutModal(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all text-sm"
                    >
                        <LogOut size={16} />
                        Secure Logout
                    </button>
                </div>
            </aside>

            <LogoutModal
                isOpen={showLogoutModal}
                onConfirm={handleConfirmLogout}
                onCancel={() => setShowLogoutModal(false)}
                isProcessing={isLoggingOut}
            />
        </>
    );
});

export default AdminSidebar;
