import React, { memo } from 'react';
import {
    LayoutDashboard, Users, FolderKanban, Bell, Settings,
    FileBarChart
} from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

const NAV_SECTIONS = [
    {
        title: 'Navigation',
        items: [
            { label: 'Dashboard', path: '/depw/dashboard', icon: LayoutDashboard },
            { label: 'Staff Management', path: '/depw/staff', icon: Users },
            { label: 'Manage Projects', path: '/depw/projects', icon: FolderKanban, activeAliases: ['/depw/create-project'] },
        ]
    },
    {
        title: 'Monitoring & Admin',
        items: [
            { label: 'Audit Trails', path: '/depw/audits', icon: FileBarChart },
            { label: 'Notifications', path: '/depw/notifications', icon: Bell },
            { label: 'Settings', path: '/depw/settings', icon: Settings },
        ]
    }
];

const DepwSidebar = memo(() => {
    const { currentUser } = useAuth();

    const userName = currentUser
        ? `Engr. ${currentUser.firstName} ${currentUser.lastName}`
        : 'Loading...';

    return (
        <Sidebar
            brandLabel="Department of Engineering and Public Works"
            navSections={NAV_SECTIONS}
            userDisplay={{ name: userName, subtitle: 'Department of Engineering and Public Works' }}
            userInitial={currentUser?.firstName?.[0]?.toUpperCase() || '?'}
            userPhotoURL={currentUser?.photoURL || null}
        />
    );
});

export default DepwSidebar;
