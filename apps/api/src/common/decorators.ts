import { SetMetadata } from "@nestjs/common";
import type { Feature, Permission } from "@axis/shared";

export const IS_PUBLIC = "axis:public";
export const REQUIRED_PERMISSION = "axis:permission";
export const REQUIRED_FEATURE = "axis:feature";
export const ALLOW_INACTIVE = "axis:allow-inactive";

/** Skips authentication (signup, login, invite links, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires the caller's resolved permissions to include `permission`. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

/** Requires the tenant's plan to include a feature (402 FEATURE_NOT_IN_PLAN otherwise). */
export const RequireFeature = (feature: Feature) => SetMetadata(REQUIRED_FEATURE, feature);

/** Writes allowed even while the subscription is suspended/canceled (billing, sign-out…). */
export const AllowInactive = () => SetMetadata(ALLOW_INACTIVE, true);
