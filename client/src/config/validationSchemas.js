import { z } from 'zod';

const NAME_REGEX = /^[a-zA-Z\s\-']+$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

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
    projectTitle: z.string()
        .min(10, "Title must be at least 10 characters")
        .max(100, "Title cannot exceed 100 characters")
        .regex(/^[a-zA-Z0-9\s\-_.,()]+$/, "Title contains invalid characters"),

    location: z.string().min(1, "Location is required"),

    budget: z.number({ invalid_type_error: "Budget must be a number" })
        .min(10000, "Minimum budget is 10,000")
        .max(1000000000, "Maximum budget exceeded"),

    description: z.string()
        .min(20, "Description must be at least 20 characters")
        .max(500, "Description cannot exceed 500 characters"),

    contractor: z.string().max(100, "Contractor name cannot exceed 100 characters").optional(),
    engineer: z.string().optional(),

    startDate: z.string().refine((date) => new Date(date) > new Date(), {
        message: "Start date must be in the future"
    }),

    completionDate: z.string().min(1, "Completion date is required")
}).refine((data) => {
    if (data.startDate && data.completionDate) {
        return new Date(data.completionDate) > new Date(data.startDate);
    }
    return true;
}, {
    message: "Completion date must be after the start date",
    path: ["completionDate"]
});

export default {
    accountProvisionSchema,
    staffProvisionSchema,
    projectSchema,
    nameSchema,
    emailSchema
};