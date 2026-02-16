import React, { useState, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import logo from '../../assets/logo.png';
import LogoutModal from '../shared/LogoutModal';

/**
 * Reusable Sidebar Shell
 *
 * @param {string}  brandLabel   - Role/department label shown under the logo (e.g. "MIS", "DEPW")
 * @param {Array}   navSections  - Array of { title, items: [{ label, path, icon, activeAliases? }] }
 * @param {object}  userDisplay  - { name, subtitle } for the footer user card
 * @param {string}  userInitial  - Single character shown in the avatar circle
 */
const Sidebar = memo(({ brandLabel, navSections, userDisplay, userInitial }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const currentPath = location.pathname;

    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    React.useEffect(() => {
        setIsMobileOpen(false);
    }, [currentPath]);

    const isActive = (item) => {
        if (currentPath === item.path) return true;
        if (item.activeAliases?.includes(currentPath)) return true;
        return false;
    };

    const handleConfirmLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try {
            await signOut(auth);
            sessionStorage.clear();
            navigate('/');
        } catch {
            setIsLoggingOut(false);
            setShowLogoutModal(false);
        }
    };

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setIsMobileOpen(true)}
                className="fixed top-4 left-4 z-20 p-2 bg-white rounded-lg shadow-md md:hidden text-slate-600 hover:text-blue-600 transition-colors"
                aria-label="Open Menu"
            >
                <Menu size={24} />
            </button>

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-30 md:hidden animate-in fade-in duration-200"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* Sidebar Panel */}
            <aside className={`w-72 bg-white border-r border-slate-200 flex flex-col fixed h-full z-40 font-sans transition-transform duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                {/* Mobile Close */}
                <button
                    onClick={() => setIsMobileOpen(false)}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 md:hidden"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>

                {/* Header / Logo */}
                <div className="p-6 flex items-center gap-3">
                    <div className="bg-white p-0.5 rounded-full shadow-lg shadow-blue-600/10 border border-slate-100 overflow-hidden w-10 h-10 flex items-center justify-center">
                        <img src={logo} alt="Logo" className="w-full h-full rounded-full object-cover" />
                    </div>
                    <div>
                        <h1 className="font-bold text-slate-900 leading-tight">TranspiraFund</h1>
                        <p className="text-[10px] font-bold text-blue-600 tracking-wider uppercase">{brandLabel}</p>
                    </div>
                </div>

                {/* Navigation Sections */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-8">
                    {navSections.map((section) => (
                        <div key={section.title}>
                            <h6 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">
                                {section.title}
                            </h6>
                            <div className="space-y-1">
                                {section.items.map((item) => {
                                    const active = isActive(item);
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
                    ))}
                </div>

                {/* Footer / User Card */}
                <div className="p-4 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm border-2 border-white shadow-sm">
                                {userInitial || '?'}
                            </div>
                            <div className="overflow-hidden">
                                <h4 className="text-sm font-bold text-slate-900 truncate">
                                    {userDisplay?.name || 'Loading...'}
                                </h4>
                                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wide truncate">
                                    {userDisplay?.subtitle || 'Official'}
                                </p>
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

            <LogoutModal
                isOpen={showLogoutModal}
                onConfirm={handleConfirmLogout}
                onCancel={() => setShowLogoutModal(false)}
                isProcessing={isLoggingOut}
            />
        </>
    );
});

export default Sidebar;
