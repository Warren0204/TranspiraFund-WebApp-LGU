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
            { label: 'Dashboard', path: '/hcsd/dashboard', icon: LayoutDashboard },
            { label: 'Staff Management', path: '/hcsd/staff', icon: Users },
            { label: 'Manage Projects', path: '/hcsd/projects', icon: FolderKanban, activeAliases: ['/hcsd/create-project'] },
        ]
    },
    {
        title: 'Monitoring & Admin',
        items: [
            { label: 'Audit Trails', path: '/hcsd/audits', icon: FileBarChart },
            { label: 'Notifications', path: '/hcsd/notifications', icon: Bell },
            { label: 'Settings', path: '/hcsd/settings', icon: Settings },
        ]
    }
];

const HcsdSidebar = memo(() => {
    const { currentUser, lguName } = useAuth();

    const userName = currentUser
        ? `Engr. ${currentUser.firstName} ${currentUser.lastName}`
        : 'Loading...';

    const brand = lguName || 'Construction Services Division';

    return (
        <Sidebar
            brandLabel={brand}
            navSections={NAV_SECTIONS}
            userDisplay={{ name: userName, subtitle: 'Construction Services Division, DEPW' }}
            userInitial={currentUser?.firstName?.[0]?.toUpperCase() || '?'}
            userPhotoURL={currentUser?.photoURL || null}
        />
    );
});

export default HcsdSidebar;
