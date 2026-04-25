import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

const AuthContext = createContext();

export const useAuth = () => {
    return useContext(AuthContext);
};

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [otpVerified, setOtpVerified] = useState(false);
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [tenantId, setTenantId] = useState(null);
    const [claimRole, setClaimRole] = useState(null);
    const [lguName, setLguName] = useState(null);
    const [tenantClassification, setTenantClassification] = useState(null);
    const [loading, setLoading] = useState(true);

    const refreshOtpStatus = async (forceRefresh = true) => {
        if (!auth.currentUser) {
            setOtpVerified(false);
            return;
        }
        const tokenResult = await auth.currentUser.getIdTokenResult(forceRefresh);
        const claims = tokenResult.claims;
        const isVerified =
            claims.otpVerified === true &&
            Number(claims.otpVerifiedAtAuthTime) === Number(claims.auth_time);
        setOtpVerified(isVerified);
    };

    const refreshUserData = async () => {
        if (!auth.currentUser) return;
        try {
            const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                setUserRole(userData.role);
                setMustChangePassword(userData.mustChangePassword === true);
                setCurrentUser(prev => ({ ...prev, ...userData }));
            }
        } catch {
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    // Read claims first. Tenant assignment is the gating
                    // requirement; an account without a tenantId claim is
                    // misconfigured (or pre-migration) and gets force-logged-out.
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;

                    if (!claims.tenantId) {
                        try {
                            sessionStorage.setItem(
                                'authError',
                                'Account is not assigned to a tenant. Contact your administrator.',
                            );
                        } catch { /* sessionStorage may be disabled */ }
                        await signOut(auth);
                        // onAuthStateChanged will fire again with user=null;
                        // let that pass clear all the fields.
                        return;
                    }

                    setTenantId(claims.tenantId);
                    setClaimRole(typeof claims.role === 'string' ? claims.role : null);

                    // Tenant doc fetch is non-blocking. If it fails (rules
                    // misconfigured, doc missing), the dashboard still
                    // renders with a null lguName — the sidebar falls back
                    // to the department label.
                    try {
                        const tenantDoc = await getDoc(doc(db, 'tenants', claims.tenantId));
                        if (tenantDoc.exists()) {
                            const td = tenantDoc.data();
                            setLguName(td.lguName || null);
                            setTenantClassification(td.classification || null);
                        } else {
                            setLguName(null);
                            setTenantClassification(null);
                        }
                    } catch {
                        setLguName(null);
                        setTenantClassification(null);
                    }

                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        setUserRole(userData.role);
                        setMustChangePassword(userData.mustChangePassword === true);
                        setCurrentUser({ ...user, ...userData });
                    } else {
                        setUserRole('GUEST');
                        setCurrentUser(user);
                    }

                    const isVerified =
                        claims.otpVerified === true &&
                        Number(claims.otpVerifiedAtAuthTime) === Number(claims.auth_time);
                    setOtpVerified(isVerified);
                } catch (error) {
                    setUserRole(null);
                    setCurrentUser(null);
                    setOtpVerified(false);
                    setMustChangePassword(false);
                    setTenantId(null);
                    setClaimRole(null);
                    setLguName(null);
                    setTenantClassification(null);
                }
            } else {
                setCurrentUser(null);
                setUserRole(null);
                setOtpVerified(false);
                setMustChangePassword(false);
                setTenantId(null);
                setClaimRole(null);
                setLguName(null);
                setTenantClassification(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const value = {
        currentUser,
        userRole,
        otpVerified,
        mustChangePassword,
        tenantId,
        claimRole,
        lguName,
        tenantClassification,
        loading,
        refreshOtpStatus,
        refreshUserData,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
