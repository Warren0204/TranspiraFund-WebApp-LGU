import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../config/firebase';

const PlatformProvisioningService = {
    provisionTenant: async ({
        tenantId,
        lguName,
        province,
        region,
        classification,
        contractReference,
        firstMisAdminEmail,
    }) => {
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const provisionTenant = httpsCallable(functions, 'provisionTenant');
            const result = await provisionTenant({
                tenantId,
                lguName,
                province,
                region,
                classification,
                contractReference,
                firstMisAdminEmail,
            });
            return result.data;
        } catch (error) {
            if (error.code === 'functions/already-exists') {
                throw new Error(`Tenant '${tenantId}' is already provisioned.`);
            }
            if (error.code === 'functions/permission-denied') {
                throw new Error('You are not authorized to provision tenants.');
            }
            throw new Error(error.message || 'Failed to provision tenant. Please try again.');
        }
    },
};

export default PlatformProvisioningService;
