import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

export function useUsers() {
    const { tenantId } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!tenantId) {
            setUsers([]);
            setLoading(false);
            return;
        }
        const unsub = onSnapshot(
            query(collection(db, 'users'), where('tenantId', '==', tenantId)),
            (snap) => {
                setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoading(false);
            },
            (error) => {
                console.error('[useUsers/users] snapshot listener error:', error);
                setUsers([]);
                setLoading(false);
            }
        );
        return () => unsub();
    }, [tenantId]);

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
