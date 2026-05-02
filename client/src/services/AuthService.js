import { auth, db } from '../config/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const AuthService = {
  login: async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      let role = 'GUEST';

      if (userDoc.exists()) {
        const userData = userDoc.data();
        role = userData.role || 'GUEST';
      } else {
        await signOut(auth);
        throw new Error('Account not provisioned. Contact system administration.');
      }

      return { user, role };

    } catch (error) {
      throw new Error(_mapFirebaseError(error.code));
    }
  }
};

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