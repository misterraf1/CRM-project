import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@axis/shared";

export const IS_PUBLIC = "axis:public";
export const REQUIRED_PERMISSION = "axis:permission";

/** Skips authentication (signup, login, invite links, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires the caller's resolved permissions to include `permission`. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);
