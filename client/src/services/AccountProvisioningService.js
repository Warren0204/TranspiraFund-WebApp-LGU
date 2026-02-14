import { getFunctions, httpsCallable } from 'firebase/functions';
import emailjs from '@emailjs/browser';
import app from '../config/firebase';

/**
 * Service to handle secure account provisioning via Cloud Functions
 * and credential delivery via EmailJS.
 */
const AccountProvisioningService = {
    /**
     * Creates an official account and emails the credentials.
     * @param {object} params - { email, firstName, lastName, roleType, department, roleLabel }
     * @returns {Promise<string>} - Returns the temporary password on success.
     */
    provisionAccount: async ({ email, firstName, lastName, roleType, department, roleLabel }) => {
        try {
            // 1. Call Cloud Function (Serverless Backend)
            const functions = getFunctions(app, 'asia-southeast1');
            const createOfficialAccount = httpsCallable(functions, 'createOfficialAccount');

            const result = await createOfficialAccount({
                email,
                firstName,
                lastName,
                roleType,
                department
            });

            const { tempPassword } = result.data;

            // 2. Send Credentials via EmailJS (Client-Side Delivery)
            if (!tempPassword) throw new Error("Failed to receive temporary password from backend.");

            const templateParams = {
                to_name: `${firstName} ${lastName}`,
                to_email: email,
                role_name: roleLabel,
                temp_password: tempPassword,
                login_url: window.location.origin + "/login",
                // Common fallbacks for standard templates
                message: `Your account has been created. Login with: ${tempPassword}`,
                reply_to: 'admin@lgu.gov.ph'
            };

            // Securely retrieve config from environment variables
            const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
            const templateId = import.meta.env.VITE_EMAILJS_PROVISION_TEMPLATE_ID;
            const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

            if (!serviceId || !templateId || !publicKey) {

                throw new Error("System configuration error: Missing EmailJS keys.");
            }

            // Email Payload Prepared - Sending via EmailJS

            try {
                await emailjs.send(
                    serviceId,
                    templateId,
                    templateParams,
                    publicKey
                );
            } catch (emailError) {
                // Log the specific EmailJS error text (often contains the 422 reason)

                throw new Error(`Failed to send email: ${emailError.text || "Unknown EmailJS error"}`);
            }

            return tempPassword;

        } catch (error) {


            // Robust Error Handling for Cloud Functions
            // Firebase Functions errors often come as objects with 'code' and 'message'
            if (error.code === 'functions/already-exists' ||
                error.message?.includes('already exists') ||
                error.details?.code === 'ALREADY_EXISTS') {
                throw new Error("This email is already registered in the system. Please use a unique email.");
            }

            // Network or unknown errors
            throw new Error(error.message || "Failed to provision account. Please try again.");
        }
    },

    /**
     * Deletes an account via Cloud Function (Admin Privilege).
     * @param {string} uid - The User ID to delete.
     */
    deleteAccount: async (uid) => {
        try {
            const functions = getFunctions(app, 'asia-southeast1');
            const deleteOfficialAccount = httpsCallable(functions, 'deleteOfficialAccount');

            await deleteOfficialAccount({ uid });
            return true;
        } catch (error) {

            throw error;
        }
    }
};

export default AccountProvisioningService;
