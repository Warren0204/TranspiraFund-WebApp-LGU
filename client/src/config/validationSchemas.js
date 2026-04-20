import { z } from 'zod';
import { PROJECT_TYPES } from './projectTypes';

const NAME_REGEX = /^[a-zA-Z\s\-']+$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PROJECT_NAME_REGEX = /^[a-zA-Z0-9\s\-_.,()]+$/;

export const nameSchema = z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name cannot exceed 50 characters")
    .regex(NAME_REGEX, "Name can only contain letters, spaces, hyphens, and apostrophes");

export const emailSchema = z
    .string()
    .email("Invalid email format")
    .regex(EMAIL_REGEX, "Please enter a valid email address");

export const accountProvisionSchema = z.object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    roleType: z.string().min(1, "Role selection is required")
});

export const staffProvisionSchema = z.object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema
});

export const projectSchema = z.object({
    // Project Details
    projectName: z.string()
        .min(10, "Project name must be at least 10 characters")
        .max(200, "Project name cannot exceed 200 characters")
        .regex(PROJECT_NAME_REGEX, "Project name contains invalid characters"),

    sitioStreet: z.string().max(200, "Sitio/Street cannot exceed 200 characters").optional(),

    barangay: z.string().min(1, "Barangay is required"),

    // Classification
    projectType: z.enum(PROJECT_TYPES, { errorMap: () => ({ message: "Project type is required" }) }),

    // Account Code & Funding
    accountCode: z.string().max(100, "Account code cannot exceed 100 characters").optional(),

    fundingSource: z.string().min(1, "Funding source is required"),

    // Contract Amount
    contractAmount: z.number({ invalid_type_error: "Contract amount must be a number" })
        .min(10000, "Minimum contract amount is ₱10,000")
        .max(1_000_000_000, "Maximum contract amount exceeded"),

    // Contractor
    contractor: z.string().max(200, "Contractor name cannot exceed 200 characters").optional(),

    // Assigned Personnel
    projectEngineer: z.string().optional(),
    projectInspector: z.string().max(100, "Inspector name cannot exceed 100 characters").optional(),
    materialInspector: z.string().max(100, "Inspector name cannot exceed 100 characters").optional(),
    electricalInspector: z.string().max(100, "Inspector name cannot exceed 100 characters").optional(),

    // Project Timeliness
    ntpReceivedDate: z.string().min(1, "NTP received date is required"),
    officialDateStarted: z.string().min(1, "Official start date is required"),
    originalDateCompletion: z.string().min(1, "Original completion date is required"),
    revisedDate1: z.string().optional(),
    revisedDate2: z.string().optional(),
    actualDateCompleted: z.string().optional(),

    // Project Accomplishment (only actualPercent stored; others computed)
    actualPercent: z.number().min(0, "Cannot be less than 0").max(100, "Cannot exceed 100").optional(),

    // Project Orders (flat fields)
    resumeOrderNumber: z.string().max(100).optional(),
    resumeOrderDate: z.string().optional(),
    timeExtensionOnOrder: z.string().max(100).optional(),
    validationOrderNumber: z.string().max(100).optional(),
    validationOrderDate: z.string().optional(),
    suspensionOrderNumber: z.string().max(100).optional(),
    suspensionOrderDate: z.string().optional(),

    // Fund Utilization
    incurredAmount: z.number().min(0, "Incurred amount cannot be negative").optional(),

    // Remarks & Action
    remarks: z.string().max(1000, "Remarks cannot exceed 1000 characters").optional(),
    actionTaken: z.string().max(1000, "Action taken cannot exceed 1000 characters").optional(),

}).refine((data) => {
    if (data.officialDateStarted && data.originalDateCompletion) {
        return new Date(data.originalDateCompletion) > new Date(data.officialDateStarted);
    }
    return true;
}, {
    message: "Completion date must be after the official start date",
    path: ["originalDateCompletion"]
});

export default {
    accountProvisionSchema,
    staffProvisionSchema,
    projectSchema,
    nameSchema,
    emailSchema
};
