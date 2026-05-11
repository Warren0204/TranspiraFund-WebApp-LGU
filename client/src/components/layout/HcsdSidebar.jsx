import { memo, useEffect, useState } from 'react';
import {
    LayoutDashboard, Users, FolderKanban, Bell, Settings,
    FileBarChart
} from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

const HcsdSidebar = memo(() => {
    const { currentUser, tenantId, lguName } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        if (!currentUser?.uid || !tenantId) {
            setUnreadCount(0);
            return;
        }
        const q = query(
            collection(db, 'notifications'),
            where('recipientUid', '==', currentUser.uid),
            where('tenantId', '==', tenantId),
            where('isRead', '==', false),
        );
        const unsub = onSnapshot(
            q,
            (snap) => setUnreadCount(snap.size),
            (err) => {
                console.error('[HcsdSidebar] unread badge listener error:', err);
                setUnreadCount(0);
            },
        );
        return unsub;
    }, [currentUser?.uid, tenantId]);

    const userName = currentUser
        ? `Engr. ${currentUser.firstName} ${currentUser.lastName}`
        : 'Loading...';

    const brand = lguName || 'Construction Services Division';

    const navSections = [
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
                { label: 'Notifications', path: '/hcsd/notifications', icon: Bell, badge: unreadCount },
                { label: 'Settings', path: '/hcsd/settings', icon: Settings },
            ]
        }
    ];

    return (
        <Sidebar
            brandLabel={brand}
            navSections={navSections}
            userDisplay={{ name: userName, subtitle: 'Construction Services Division, DEPW' }}
            userInitial={currentUser?.firstName?.[0]?.toUpperCase() || '?'}
            userPhotoURL={currentUser?.photoURL || null}
        />
    );
});

export default HcsdSidebar;
