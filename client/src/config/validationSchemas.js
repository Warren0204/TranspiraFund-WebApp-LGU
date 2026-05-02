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
