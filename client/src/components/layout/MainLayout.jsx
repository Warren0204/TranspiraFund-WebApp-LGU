import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar'; // We created this earlier

const MainLayout = ({ role }) => {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      
      {/* LEFT SIDE: Navigation Sidebar */}
      <aside className="w-64 flex-shrink-0 z-20">
        <Sidebar currentUserRole={role} />
      </aside>

      {/* RIGHT SIDE: Main Content Area */}
      <main className="flex-1 overflow-y-auto relative">
        
        {/* Top Header (Optional - Good for Profile/Notifications) */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
          <h1 className="text-lg font-semibold text-slate-700">
            {/* Dynamic Title based on Role */}
            {role === 'MIS' && 'System Administration'}
            {role === 'MAYOR' && 'Executive Command Center'}
            {role === 'DEPW' && 'Engineering Operations'}
            {role === 'CPDO' && 'Planning & Compliance'}
          </h1>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">Official Session Active</span>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          </div>
        </header>

        {/* The Page Content goes here (Dashboard, Settings, etc.) */}
        <div className="p-8">
          <Outlet />
        </div>

      </main>
    </div>
  );
};

export default MainLayout;