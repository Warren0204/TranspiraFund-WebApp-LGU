import { Shield, Upload, Sun, Moon, User } from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const Settings = () => {
    const { currentUser } = useAuth();
    const { isDark, toggle } = useTheme();

    const userName = currentUser
        ? `Engr. ${currentUser.firstName} ${currentUser.lastName}`
        : 'Loading Identity...';

    const userRole = currentUser?.role === 'DEPW' ? 'DEPW_HEAD' : (currentUser?.role || 'OFFICIAL');
    const userDept = currentUser?.department || 'Department of Engineering and Public Works';
    const userInitial = currentUser?.firstName?.charAt(0).toUpperCase() || 'D';

    return (
        <div className="min-h-screen depw-bg font-sans text-slate-900 dark:text-slate-100">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-6 lg:p-10 pt-20 md:pt-10">

                {/* PAGE HEADER */}
                <div className="mb-8" style={{ animation: 'fadeIn 0.4s ease-out both' }}>
                    <div className="inline-flex items-center gap-2 bg-slate-500/10 dark:bg-slate-400/10 border border-slate-400/20 rounded-full px-3 py-1 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 dark:bg-slate-400" />
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Account Settings</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                        System Configuration
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                        Manage account security, display preferences, and profile identity.
                    </p>
                </div>

                <div className="space-y-5">

                    {/* CARD 1: OFFICIAL IDENTITY */}
                    <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                        style={{ animation: 'slideUp 0.5s ease-out 0.1s both' }}>

                        {/* Card Header */}
                        <div className="px-7 py-4 border-b border-slate-100 dark:border-slate-700/40 bg-slate-50/60 dark:bg-slate-800/20 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center shadow-md">
                                <User size={15} className="text-white" />
                            </div>
                            <h2 className="font-bold text-slate-800 dark:text-slate-100 text-base">Official Identity</h2>
                        </div>

                        <div className="p-6 sm:p-8">
                            <div className="flex flex-col sm:flex-row gap-7 items-center sm:items-start">

                                {/* Avatar */}
                                <div className="flex flex-col items-center gap-3 shrink-0">
                                    <div className="relative">
                                        <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center text-white text-4xl font-extrabold shadow-2xl shadow-teal-500/25">
                                            {currentUser?.photoURL ? (
                                                <img src={currentUser.photoURL} alt="Profile" className="w-full h-full rounded-2xl object-cover" />
                                            ) : userInitial}
                                        </div>
                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 shadow-sm" />
                                    </div>
                                    <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm"
                                        aria-label="Upload profile photo">
                                        <Upload size={13} />
                                        Upload Photo
                                    </button>
                                    <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-wide">Max 2MB · JPG/PNG</span>
                                </div>

                                {/* Fields */}
                                <div className="flex-1 w-full space-y-5">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">Official Name</label>
                                            <div className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 cursor-not-allowed text-sm select-none">
                                                {userName}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">Role</label>
                                            <div className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-500 dark:text-slate-400 cursor-not-allowed text-sm select-none uppercase">
                                                {userRole}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">Department</label>
                                        <div className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-500 dark:text-slate-400 cursor-not-allowed text-sm select-none">
                                            {userDept}
                                        </div>
                                    </div>

                                    {/* Security notice */}
                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-500/20 rounded-2xl flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                                            <Shield className="text-amber-500 dark:text-amber-400" size={16} />
                                        </div>
                                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
                                            <span className="font-bold">Profile details are managed centrally by MIS.</span> Contact the administrator for corrections or role updates.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CARD 2: DISPLAY PREFERENCES */}
                    <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur-xl border border-white/80 dark:border-white/5 rounded-[24px] shadow-xl overflow-hidden"
                        style={{ animation: 'slideUp 0.5s ease-out 0.2s both' }}>

                        {/* Card Header */}
                        <div className="px-7 py-4 border-b border-slate-100 dark:border-slate-700/40 bg-slate-50/60 dark:bg-slate-800/20 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 dark:from-slate-500 dark:to-slate-700 flex items-center justify-center shadow-md">
                                {isDark ? <Moon size={15} className="text-white" /> : <Sun size={15} className="text-white" />}
                            </div>
                            <h2 className="font-bold text-slate-800 dark:text-slate-100 text-base">Display Preferences</h2>
                        </div>

                        <div className="p-6 sm:p-8">
                            {/* Dark mode toggle */}
                            <div className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/40 rounded-2xl">
                                <div className="flex items-center gap-4">
                                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 dark:from-indigo-500 dark:to-purple-500 flex items-center justify-center shadow-lg transition-all">
                                        {isDark
                                            ? <Moon size={20} className="text-white" />
                                            : <Sun size={20} className="text-white" />
                                        }
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                                            {isDark ? 'Dark Mode' : 'Light Mode'}
                                        </h4>
                                        <p className="text-sm font-medium text-slate-400 dark:text-slate-500 mt-0.5">
                                            {isDark ? 'Easier on the eyes in low-light environments' : 'Bright theme for well-lit offices'}
                                        </p>
                                    </div>
                                </div>

                                {/* Toggle switch */}
                                <button onClick={toggle} aria-label="Toggle dark mode"
                                    className={`relative w-14 h-7 rounded-full transition-all duration-300 shrink-0 ${isDark ? 'bg-indigo-500 shadow-lg shadow-indigo-500/30' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                    <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${isDark ? 'left-7' : 'left-0.5'}`} />
                                </button>
                            </div>

                            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-4 text-center">
                                Theme preference is saved automatically to your browser.
                            </p>
                        </div>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default Settings;
