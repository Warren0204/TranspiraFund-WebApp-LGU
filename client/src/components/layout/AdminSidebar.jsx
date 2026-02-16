import React, { memo } from 'react';
import { LayoutDashboard, Users } from 'lucide-react';
import Sidebar from './Sidebar';

const NAV_SECTIONS = [
    {
        title: 'Navigation',
        items: [
            { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
            { label: 'Account Management', path: '/admin/accounts', icon: Users },
        ]
    }
];

const AdminSidebar = memo(() => (
    <Sidebar
        brandLabel="MIS"
        navSections={NAV_SECTIONS}
        userDisplay={{ name: 'System Admin', subtitle: 'IT Operations' }}
        userInitial="S"
    />
));

export default AdminSidebar;
