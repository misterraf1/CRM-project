import { z } from "zod";
import { MEMBER_ROLES } from "./permissions";

// Request bodies validated identically by the web forms and the API.

const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(8).max(128);
const fullName = z.string().trim().min(2).max(100);

export const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  fullName,
  email,
  password,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  tenantSlug: z.string().trim().toLowerCase().max(63).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password });

export const switchTenantSchema = z.object({ tenantId: z.string().min(1).max(64) });

export const inviteSchema = z.object({
  email,
  fullName: fullName.optional(),
  role: z.enum(MEMBER_ROLES).default("EMPLOYEE"),
  departmentId: z.string().min(1).max(64).nullish(),
  title: z.string().trim().max(100).nullish(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInviteSchema = z.object({
  fullName: fullName.optional(),
  password,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const updateMemberSchema = z
  .object({
    role: z.enum(MEMBER_ROLES).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    departmentId: z.string().min(1).max(64).nullable().optional(),
    title: z.string().trim().max(100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  headId: z.string().min(1).max(64).nullish(),
  parentId: z.string().min(1).max(64).nullish(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;
