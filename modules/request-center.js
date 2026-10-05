// Shared navigation for the Pilot request center. Filters never grant data access.
(function () {
  const FILTER_KEYS = ["type", "scope", "status", "view", "q", "ncrStatus"];
  function url(params, changes = {}) {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = Object.prototype.hasOwnProperty.call(changes, key) ? changes[key] : params.get(key);
      if (value && (value !== "all" || key === "type" || key === "ncrStatus")) next.set(key, value);
    }
    if (changes.mode === "create") {
      next.set("mode", "create");
      // The list filter and the type being created are separate choices.
      const createType = Object.prototype.hasOwnProperty.call(changes, "createType") ? changes.createType : params.get("createType");
      if (createType) next.set("createType", createType);
    }
    return `#/requests${hasParams(next) ? `?${next}` : ""}`;
  }
  // URLSearchParams.size is missing before Safari 17 / Chrome 113, so test the serialized query.
  function hasParams(params) {
    return params.toString() !== "";
  }
  function statusList(params, known) {
    return (params.get("status") ?? "all").split(",").filter((value) => value !== "all" && known.includes(value));
  }
  function pendingStatuses(code) {
    if (code === "NCR_CAR") return ["awaiting_disposition", "awaiting_response", "awaiting_followup", "awaiting_signoff", "awaiting_info"];
    const common = ["pending_approval", "more_info"];
    return code === "MANAGEMENT" ? common : [...common, "approved", "pending_assign", "assigned", "in_progress", "pending_verify"];
  }
  // The main menu always opens the module overview: an explicit type=all skips the module
  // remembered for bare #/requests links, and survives the page's own URL rewrite unchanged.
  function overviewUrl() {
    return url(new URLSearchParams(), { type: "all" });
  }
  function createUrl(params) {
    const type = params.get("type");
    return type && type !== "all" ? url(params, { mode: "create", createType: type }) : null;
  }
  const api = { url, hasParams, statusList, pendingStatuses, createUrl, overviewUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_REQUEST_CENTER = api;
})();
