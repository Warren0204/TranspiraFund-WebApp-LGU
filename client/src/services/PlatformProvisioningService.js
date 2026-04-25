import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../config/firebase';

// Wraps the provisionTenant Cloud Function. The callable is gated by the
// platformAdmin custom claim, which is granted via scripts/grant-platform-admin.js
// and never set by any callable in this codebase. v1 ships this service so a
// future tenant-onboarding UI can drop in cleanly; for v1 there is no UI
// surface and the function is invoked from a dev console or a separate admin
// tool.
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
