import React, { useState, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutDashboard, Users, FolderKanban, FileText, Bell, Settings, LogOut, HardHat,
    Briefcase, AlertTriangle, FileBarChart, Menu, X
} from 'lucide-react';
import { getAuth } from 'firebase/auth';
import logo from '../../assets/logo.png';
import LogoutModal from '../shared/LogoutModal';


const DepwSidebar = memo(() => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    // Close mobile sidebar on route change
    React.useEffect(() => {
        setIsMobileOpen(false);
    }, [location.pathname]);

    const isActive = (path) => {
        if (location.pathname === path) return true;
        // Keep 'Manage Projects' active when on Create Project page
        if (path === '/depw/projects' && location.pathname === '/depw/create-project') return true;
        return false;
    };

    const handleConfirmLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try {
            const auth = getAuth();
            await auth.signOut();
            sessionStorage.clear();
            navigate('/');
        } catch (error) {

            setIsLoggingOut(false);
            setShowLogoutModal(false); // Close modal on error to allow retry
        }
    };

    const navItems = [
        { label: 'Dashboard', path: '/depw/dashboard', icon: LayoutDashboard },
        { label: 'Staff Management', path: '/depw/staff', icon: Users },
        { label: 'Manage Projects', path: '/depw/projects', icon: FolderKanban },
    ];

    const adminItems = [
        { label: 'Audit Trails', path: '/depw/audits', icon: FileBarChart },
        { label: 'Notifications', path: '/depw/notifications', icon: Bell },
        { label: 'Settings', path: '/depw/settings', icon: Settings },
    ];

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

            {/* SIDEBAR PANEL */}
            <aside className={`w-72 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 font-sans transition-transform duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                {/* CLOSE BUTTON - Mobile Only */}
                <button
                    onClick={() => setIsMobileOpen(false)}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 md:hidden"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>

                {/* HEADER / LOGO */}
                <div className="p-6 flex items-center gap-3">
                    <div className="bg-white p-0.5 rounded-full shadow-lg shadow-blue-600/10 border border-slate-100 overflow-hidden w-10 h-10 flex items-center justify-center">
                        <img src={logo} alt="Logo" className="w-full h-full rounded-full object-cover" />
                    </div>
                    <div>
                        <h1 className="font-bold text-slate-900 leading-tight">TranspiraFund</h1>
                        <p className="text-[10px] font-bold text-blue-600 tracking-wider uppercase">DEPW</p>
                    </div>
                </div>

                {/* NAVIGATION */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-8">

                    {/* Main Nav */}
                    <div>
                        <h6 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">Navigation</h6>
                        <div className="space-y-1">
                            {navItems.map((item) => {
                                const active = isActive(item.path);
                                return (
                                    <button
                                        key={item.path}
                                        onClick={() => navigate(item.path)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${active
                                            ? 'bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100'
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                                            }`}
                                    >
                                        <item.icon size={18} strokeWidth={active ? 2.5 : 2} />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Admin / Monitoring */}
                    <div>
                        <h6 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">Monitoring & Admin</h6>
                        <div className="space-y-1">
                            {adminItems.map((item) => {
                                const active = isActive(item.path);
                                return (
                                    <button
                                        key={item.path}
                                        onClick={() => navigate(item.path)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${active
                                            ? 'bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100'
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                                            }`}
                                    >
                                        <item.icon size={18} strokeWidth={active ? 2.5 : 2} />
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* FOOTER / LOGOUT */}
                <div className="p-4 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm border-2 border-white shadow-sm">
                                E
                            </div>
                            <div className="overflow-hidden">
                                <h4 className="text-sm font-bold text-slate-900 truncate">Engr. Sarah Connor</h4>
                                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide truncate">City Engineer</p>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowLogoutModal(true)}
                            className="w-full flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold py-2.5 rounded-xl transition-all shadow-sm"
                        >
                            <LogOut size={14} />
                            Secure Logout
                        </button>
                    </div>
                </div>
            </aside>

            {/* Logout Confirmation Modal */}
            <LogoutModal
                isOpen={showLogoutModal}
                onConfirm={handleConfirmLogout}
                onCancel={() => setShowLogoutModal(false)}
                isProcessing={isLoggingOut}
            />
        </>
    );
});

export default DepwSidebar;
