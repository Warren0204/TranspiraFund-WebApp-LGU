import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../config/firebase';

const AccountProvisioningService = {
    provisionAccount: async ({ email, firstName, lastName, roleType, department }) => {
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const createOfficialAccount = httpsCallable(functions, 'createOfficialAccount');

            const result = await createOfficialAccount({
                email,
                firstName,
                lastName,
                roleType,
                department,
            });

            return result.data.message;

        } catch (error) {
            if (
                error.code === 'functions/already-exists' ||
                error.message?.includes('already exists')
            ) {
                throw new Error('This email is already registered. Please use a unique email.');
            }
            throw new Error(error.message || 'Failed to provision account. Please try again.');
        }
    },

    deleteAccount: async (uid) => {
        const functions = getFunctions(app, 'asia-southeast1');
        const deleteOfficialAccount = httpsCallable(functions, 'deleteOfficialAccount');
        await deleteOfficialAccount({ uid });
    },
};

export default AccountProvisioningService;