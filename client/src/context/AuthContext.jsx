import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
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
                    const tokenResult = await user.getIdTokenResult();
                    const claims = tokenResult.claims;
                    const isVerified =
                        claims.otpVerified === true &&
                        Number(claims.otpVerifiedAtAuthTime) === Number(claims.auth_time);
                    setOtpVerified(isVerified);
                } catch (error) {
                    setUserRole(null);
                    setCurrentUser(null);
                    setOtpVerified(false);
                    setMustChangePassword(false);
                }
            } else {
                setCurrentUser(null);
                setUserRole(null);
                setOtpVerified(false);
                setMustChangePassword(false);
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
