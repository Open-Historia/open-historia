/*! Open Historia — manual update-check command bridge © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

export const APP_UPDATE_MANUAL_CHECK_EVENT = "oh:app-update-check-now";
export const APP_UPDATE_MANUAL_CHECK_RESULT_EVENT = "oh:app-update-check-result";

export const requestAppUpdateCheck = () => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new Event(APP_UPDATE_MANUAL_CHECK_EVENT));
  return true;
};

export const publishAppUpdateCheckResult = (detail = {}) => {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(APP_UPDATE_MANUAL_CHECK_RESULT_EVENT, { detail }));
  return true;
};

export const appUpdateCheckDescription = (result = {}) => {
  switch (result?.status) {
    case "checking": return "Checking the release channel right now…";
    case "available": return "Update available — use the update banner above to install it.";
    case "current": return "You are up to date.";
    case "unsupported": return "This build does not support in-app update checks.";
    case "error": return result?.message || "Could not check for updates. Try again.";
    default: return "Check the installed app for a newer build right now.";
  }
};
