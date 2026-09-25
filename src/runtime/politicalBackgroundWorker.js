/*! Open Historia — political background simulation worker (Continuum) */

import { advancePoliticalBackgroundKernel } from "./politicalBackgroundKernel.js";

self.onmessage = (event) => {
  const id = Number(event?.data?.id);
  try {
    const result = advancePoliticalBackgroundKernel(event?.data?.payload || {});
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Political background worker failed." });
  }
};
