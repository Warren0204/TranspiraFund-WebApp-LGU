import React from 'react';
import {
    Settings as SettingsIcon, Shield, Upload, AlertCircle
} from 'lucide-react';
import DepwSidebar from '../../components/layout/DepwSidebar';
import { useAuth } from '../../context/AuthContext';

const Settings = () => {
    const { currentUser } = useAuth();

    // Fallbacks for data to ensure UI doesn't break
    const userName = currentUser
        ? `Engr. ${currentUser.firstName} ${currentUser.lastName}`
        : 'Loading Identity...';

    // Fallback role formatting
    const userRole = currentUser?.role === 'DEPW' ? 'DEPW_HEAD' : (currentUser?.role || 'OFFICIAL');
    const userDept = currentUser?.department || 'Department of Engineering and Public Works';

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <DepwSidebar />

            <main className="ml-0 md:ml-72 p-4 md:p-10 max-w-[1200px] mx-auto">
                {/* PAGE HEADER */}
                <div className="mb-10">
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                        <SettingsIcon className="text-blue-600" size={32} />
                        System Configuration
                    </h1>
                    <p className="text-slate-500 font-medium mt-1 ml-11">
                        Manage account security, display preferences, and profile identity.
                    </p>
                </div>

                <div className="space-y-6">
                    {/* CARD 1: OFFICIAL IDENTITY */}
                    <div className="bg-white rounded-[32px] p-10 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-8">
                            <div className="w-1 h-6 bg-slate-200 rounded-full"></div>
                            <span className="text-slate-400">Official Identity</span>
                        </h2>

                        <div className="flex gap-10 items-start">
                            {/* PHOTO SECTION */}
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-32 h-32 rounded-full bg-slate-100 border-4 border-white shadow-lg flex items-center justify-center text-slate-300">
                                    {currentUser?.photoURL ? (
                                        <img src={currentUser.photoURL} alt="Profile" className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        <SettingsIcon size={48} className="opacity-20" />
                                    )}
                                </div>
                                <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm" aria-label="Upload profile photo">
                                    <Upload size={14} />
                                    Upload Photo
                                </button>
                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">Max 2MB (JPG/PNG)</span>
                            </div>

                            {/* FIELDS SECTION */}
                            <div className="flex-1 space-y-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Official Name</label>
                                        <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 select-none cursor-not-allowed flex items-center text-sm">
                                            {userName}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Role / Department</label>
                                        <div className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-500 select-none cursor-not-allowed flex items-center text-sm uppercase">
                                            {userRole}
                                        </div>
                                    </div>
                                </div>

                                {/* SECURITY NOTICE */}
                                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                    <Shield className="text-amber-500 shrink-0 mt-0.5" size={20} />
                                    <p className="text-xs font-medium text-amber-800 leading-relaxed">
                                        <span className="font-bold">Core profile details are managed centrally by the MIS Department</span> to ensure data integrity. Contact admin for corrections or role updates.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CARD 2: INTERFACE PREFERENCES */}
                    <div className="bg-white rounded-[32px] p-10 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-8">
                            <SettingsIcon size={20} className="text-slate-300" />
                            Interface Preferences
                        </h2>

                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center">
                                    <SettingsIcon size={20} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">Theme Customization</h4>
                                    <p className="text-xs font-medium text-slate-400">Coming soon in a future update.</p>
                                </div>
                            </div>

                            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-lg">Coming Soon</span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Settings;
