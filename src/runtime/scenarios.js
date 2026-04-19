import { useSyncExternalStore } from "react";
import {
  setCountryNameResolver,
  setRuntimeAssetEndpoints,
} from "./assets.js";

const SCENARIOS_API_ROOT = "/api/scenarios";

const INITIAL_SCENARIO_STATE = {
  activeScenario: null,
  activeScenarioId: null,
  baseSaves: [],
  error: null,
  loaded: false,
  loading: false,
  scenarios: [],
  token: "",
};

let scenarioState = INITIAL_SCENARIO_STATE;
let scenarioCatalogRequest = null;
const listeners = new Set();

const emitScenarioState = () => {
  for (const listener of listeners) {
    listener();
  }
};

const normalizeLookupKey = (value) => String(value ?? "").trim().toUpperCase();

const resolveCountryNameOverride = (overrides, name, code) => {
  if (!overrides || typeof overrides !== "object") {
    return name;
  }

  const codeKey = normalizeLookupKey(code);
  if (codeKey && typeof overrides[codeKey] === "string" && overrides[codeKey].trim()) {
    return overrides[codeKey].trim();
  }

  const exactName = String(name ?? "").trim();
  if (exactName && typeof overrides[exactName] === "string" && overrides[exactName].trim()) {
    return overrides[exactName].trim();
  }

  const normalizedName = normalizeLookupKey(name);
  if (
    normalizedName &&
    typeof overrides[normalizedName] === "string" &&
    overrides[normalizedName].trim()
  ) {
    return overrides[normalizedName].trim();
  }

  return name;
};

const syncScenarioRuntime = () => {
  const token = scenarioState.activeScenario?.cacheToken ?? "";
  setRuntimeAssetEndpoints({ token });
  setCountryNameResolver((name, code) =>
    resolveCountryNameOverride(scenarioState.activeScenario?.countryNameOverrides, name, code),
  );
};

const setScenarioState = (nextState) => {
  scenarioState = nextState;
  syncScenarioRuntime();
  emitScenarioState();
};

const parseApiResponse = async (response) => {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return payload;
  }

  const message =
    payload?.error ||
    payload?.message ||
    `Request failed with HTTP ${response.status}`;
  throw new Error(message);
};

const requestJson = async (pathname, { body, method = "GET" } = {}) => {
  const response = await fetch(pathname, {
    body: body == null ? undefined : JSON.stringify(body),
    headers: body == null ? undefined : { "Content-Type": "application/json" },
    method,
  });

  return parseApiResponse(response);
};

const applyScenarioCatalog = (catalog) => {
  const scenarios = Array.isArray(catalog?.scenarios) ? catalog.scenarios : [];
  const activeScenarioId =
    catalog?.activeScenarioId ??
    scenarios[0]?.id ??
    null;
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null;

  setScenarioState({
    activeScenario,
    activeScenarioId,
    baseSaves: Array.isArray(catalog?.baseSaves) ? catalog.baseSaves : [],
    error: null,
    loaded: true,
    loading: false,
    scenarios,
    token: activeScenario?.cacheToken ?? "",
  });

  return scenarioState;
};

export const getScenarioState = () => scenarioState;

export const subscribeToScenarioState = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useScenarioState = () =>
  useSyncExternalStore(subscribeToScenarioState, getScenarioState, getScenarioState);

export const refreshScenarioCatalog = async ({ force = false } = {}) => {
  if (scenarioCatalogRequest && !force) {
    return scenarioCatalogRequest;
  }

  setScenarioState({
    ...scenarioState,
    error: null,
    loading: true,
  });

  scenarioCatalogRequest = requestJson(SCENARIOS_API_ROOT)
    .then((catalog) => applyScenarioCatalog(catalog))
    .catch((error) => {
      setScenarioState({
        ...scenarioState,
        error: error.message,
        loaded: true,
        loading: false,
      });
      throw error;
    })
    .finally(() => {
      scenarioCatalogRequest = null;
    });

  return scenarioCatalogRequest;
};

export const ensureScenarioCatalog = async () => {
  if (scenarioState.loaded) {
    return scenarioState;
  }

  return refreshScenarioCatalog();
};

export const loadScenarioDetails = async (scenarioId) =>
  requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`);

export const createScenario = async (payload) => {
  const details = await requestJson(SCENARIOS_API_ROOT, {
    body: payload,
    method: "POST",
  });
  await refreshScenarioCatalog({ force: true });
  return details;
};

export const saveScenario = async (scenarioId, payload) => {
  const details = await requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`, {
    body: payload,
    method: "PUT",
  });
  await refreshScenarioCatalog({ force: true });
  return details;
};

export const activateScenario = async (scenarioId) => {
  const catalog = await requestJson(`${SCENARIOS_API_ROOT}/active`, {
    body: { scenarioId },
    method: "PUT",
  });
  return applyScenarioCatalog(catalog);
};

export const removeScenario = async (scenarioId) => {
  const catalog = await requestJson(`${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}`, {
    method: "DELETE",
  });
  return applyScenarioCatalog(catalog);
};

const toUploadBuffer = async (file) => {
  if (file instanceof Blob) {
    return file.arrayBuffer();
  }

  if (file instanceof ArrayBuffer) {
    return file;
  }

  if (ArrayBuffer.isView(file)) {
    return file.buffer;
  }

  return new TextEncoder().encode(String(file ?? "")).buffer;
};

export const uploadScenarioAsset = async (scenarioId, assetKey, file) => {
  const response = await fetch(
    `${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      body: await toUploadBuffer(file),
      headers: {
        "Content-Type": file?.type || "application/octet-stream",
      },
      method: "PUT",
    },
  );

  const details = await parseApiResponse(response);
  await refreshScenarioCatalog({ force: true });
  return details;
};

export const clearScenarioAsset = async (scenarioId, assetKey) => {
  const details = await requestJson(
    `${SCENARIOS_API_ROOT}/${encodeURIComponent(scenarioId)}/assets/${encodeURIComponent(assetKey)}`,
    {
      method: "DELETE",
    },
  );
  await refreshScenarioCatalog({ force: true });
  return details;
};

export const resolveScenarioCountryName = (name, code) =>
  resolveCountryNameOverride(scenarioState.activeScenario?.countryNameOverrides, name, code);

syncScenarioRuntime();
