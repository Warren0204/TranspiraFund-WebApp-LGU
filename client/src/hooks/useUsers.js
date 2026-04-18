import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Real-time directory of all user documents, keyed by UID.
 *
 * Single source of truth for display name / email / photoURL / role —
 * any page that shows an actor, engineer, or assignee should hydrate
 * from `usersMap[uid]` rather than duplicating user fields on other
 * collections (audit entries, projects, milestones, etc.).
 *
 * Only callable from HCSD and MIS contexts; Firestore rules block
 * other roles from reading the full users collection, in which case
 * the hook resolves to an empty map silently.
 */
export function useUsers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(
            collection(db, 'users'),
            (snap) => {
                setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            },
            () => { setUsers([]); setLoading(false); }
        );
        return () => unsub();
    }, []);

    const usersMap = useMemo(() => {
        const m = {};
        users.forEach(u => { m[u.id] = u; });
        return m;
    }, [users]);

    const displayName = (uid) => {
        const u = usersMap[uid];
        if (!u) return null;
        const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return full || u.email || null;
    };

    const initials = (uid) => {
        const u = usersMap[uid];
        if (!u) return '?';
        const f = (u.firstName || '').charAt(0);
        const l = (u.lastName || '').charAt(0);
        return (f + l).toUpperCase() || (u.email?.charAt(0).toUpperCase() ?? '?');
    };

    return { users, usersMap, loading, displayName, initials };
}
