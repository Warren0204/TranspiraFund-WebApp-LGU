import { auth, db } from '../config/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const AuthService = {
  /**
   * 1. Authenticate User with Firebase
   * @param {string} email 
   * @param {string} password 
   * @returns {Promise<{user: object, role: string}>}
   */
  login: async (email, password) => {
    try {
      // A. Verify Credentials with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // B. Fetch Role & Permissions from Firestore Database
      // We look for a document in the 'users' collection matching this UID
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      let role = 'GUEST'; // Default fallback

      if (userDoc.exists()) {
        const userData = userDoc.data();
        role = userData.role || 'GUEST'; // e.g., 'MIS', 'MAYOR'
      } else {
        // Zero-Trust: No Firestore profile = No access.
        await signOut(auth);
        throw new Error('Account not provisioned. Contact system administration.');
      }

      return { user, role };

    } catch (error) {
      // Return a sanitized error message (Security Best Practice)

      throw new Error(_mapFirebaseError(error.code));
    }
  },

  /**
   * 2. Secure Logout
   */
  logout: async () => {
    try {
      await signOut(auth);
      // Optional: Clear any local session state here if needed
    } catch (error) {

    }
  }
};

/**
 * Helper: Map cryptic Firebase errors to user-friendly messages
 * (Information Hiding Principle)
 */
const _mapFirebaseError = (code) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid official ID or secure credential.';
    case 'auth/too-many-requests':
      return 'Access temporarily locked due to multiple failed attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Connection lost. Please check your secure network.';
    default:
      return 'Authentication failed. Please contact system administration.';
  }
};

export default AuthService;