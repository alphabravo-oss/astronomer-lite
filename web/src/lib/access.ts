import type { AccessReviewResponse } from "./api";

export type AccessCheck = {
  checking: boolean;
  response: AccessReviewResponse | null;
  error: string;
};

export function accessCheckFromSettled(result: PromiseSettledResult<AccessReviewResponse | null>): AccessCheck {
  if (result.status === "fulfilled") {
    return { checking: false, response: result.value, error: "" };
  }
  return {
    checking: false,
    response: null,
    error: result.reason instanceof Error ? result.reason.message : "Authorization check unavailable"
  };
}

export function isAccessDenied(check: AccessCheck) {
  return check.response?.allowed === false || check.response?.denied === true;
}

export function isAccessBlocked(check: AccessCheck) {
  return check.checking || isAccessDenied(check);
}

export function accessDeniedMessage(check: AccessCheck) {
  if (!isAccessDenied(check)) return "";
  return check.response?.reason || "Not allowed by Kubernetes RBAC.";
}

export function accessStatusMessage(check: AccessCheck) {
  if (check.checking) return "Checking Kubernetes authorization...";
  return accessDeniedMessage(check) || (check.error ? `Authorization check unavailable: ${check.error}` : "");
}
