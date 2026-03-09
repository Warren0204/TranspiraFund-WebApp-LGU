import { memo } from 'react';
import { LayoutDashboard, Users, Settings, ScrollText } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

const NAV_SECTIONS = [
    {
        title: 'Navigation',
        items: [
            { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
            { label: 'Account Management', path: '/admin/accounts', icon: Users },
            { label: 'Audit Trails', path: '/admin/audits',   icon: ScrollText },
            { label: 'Settings',   path: '/admin/settings', icon: Settings },
        ]
    }
];

const AdminSidebar = memo(() => {
    const { currentUser } = useAuth();

    const firstName = currentUser?.firstName || '';
    const lastName = currentUser?.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'System Admin';
    const initial = firstName?.[0]?.toUpperCase() || fullName[0]?.toUpperCase() || 'S';
    const department = currentUser?.department || 'IT Operations';

    return (
        <Sidebar
            brandLabel="MIS"
            navSections={NAV_SECTIONS}
            userDisplay={{ name: fullName, subtitle: department }}
            userInitial={initial}
        />
    );
});

export default AdminSidebar;
