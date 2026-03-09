import React, { useState, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import logo from '../../assets/logo.png';
import LogoutModal from '../shared/LogoutModal';

const Sidebar = memo(({ brandLabel, navSections, userDisplay, userInitial, userPhotoURL }) => {
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

            <div className="fixed top-0 left-0 right-0 z-20 md:hidden bg-white/90 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/60 px-4 py-2.5 flex items-center justify-between transition-colors duration-300">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                        <img src={logo} alt="Logo" className="w-full h-full object-cover scale-[1.3]" />
                    </div>
                    <div>
                        <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">TranspiraFund</h1>
                        <p className="text-[9px] font-bold text-teal-700 dark:text-cyan-400 tracking-wider uppercase">{brandLabel}</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsMobileOpen(true)}
                    className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-200"
                    aria-label="Open Menu"
                >
                    <Menu size={22} />
                </button>
            </div>


            {isMobileOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-30 md:hidden animate-in fade-in duration-200"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}


            <aside className={`w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col fixed h-full z-40 font-sans transition-all duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>


                <button
                    onClick={() => setIsMobileOpen(false)}
                    className="absolute top-4 right-4 p-2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-200 md:hidden"
                    aria-label="Close menu"
                >
                    <X size={20} />
                </button>


                <div className="p-6 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 ring-2 ring-teal-500/20">
                        <img src={logo} alt="Logo" className="w-full h-full object-cover scale-[1.3]" />
                    </div>
                    <div>
                        <h1 className="font-extrabold text-slate-900 dark:text-white leading-tight tracking-tight">TranspiraFund</h1>
                        <p className="text-[10px] font-bold text-teal-700 dark:text-cyan-400 tracking-[0.15em] uppercase">{brandLabel}</p>
                    </div>
                </div>


                <div className="flex-1 overflow-y-auto px-3 py-5 space-y-8">
                    {navSections.map((section) => (
                        <div key={section.title}>
                            <h6 className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.18em] px-4 mb-3">
                                {section.title}
                            </h6>
                            <div className="space-y-1">
                                {section.items.map((item) => {
                                    const active = isActive(item);
                                    return (
                                        <button
                                            key={item.path}
                                            onClick={() => navigate(item.path)}
                                            className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${active
                                                ? 'bg-gradient-to-r from-teal-50 to-cyan-50/30 dark:from-teal-900/25 dark:to-cyan-900/10 text-teal-700 dark:text-cyan-400 shadow-sm'
                                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                                                }`}
                                        >

                                            {active && (
                                                <span className="absolute left-0 top-[18%] bottom-[18%] w-[3px] bg-gradient-to-b from-teal-500 to-cyan-400 rounded-r-full" />
                                            )}
                                            <item.icon
                                                size={18}
                                                strokeWidth={active ? 2.5 : 2}
                                                className={active ? 'text-teal-600 dark:text-cyan-400' : ''}
                                            />
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>


                <div className="p-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-cyan-400 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-teal-500/20 shrink-0 overflow-hidden">
                                {userPhotoURL ? (
                                    <img src={userPhotoURL} alt="Profile" className="w-full h-full object-cover" />
                                ) : (userInitial || '?')}
                            </div>
                            <div className="overflow-hidden">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                    {userDisplay?.name || 'Loading...'}
                                </h4>
                                <p className="text-[10px] font-bold text-teal-700 dark:text-cyan-400 uppercase tracking-wide truncate">
                                    {userDisplay?.subtitle || 'Official'}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowLogoutModal(true)}
                            className="w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-900/80 border border-teal-200/60 dark:border-slate-700 hover:bg-teal-50 dark:hover:bg-slate-800 text-teal-700 dark:text-slate-300 text-xs font-bold py-2.5 rounded-xl transition-all duration-200 shadow-sm"
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
