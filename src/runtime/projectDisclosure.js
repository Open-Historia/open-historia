// One narrow public-event boundary for the Projects engine. The engine still
// simulates every project; only public entries may be automatically narrated as
// milestones/completions. Exposures must arise from a separate, authorized
// intelligence/event source, not an omniscient project forecast.
import { sameName } from "../../server/nameKey.js";

const list = (value) => (Array.isArray(value) ? value : []);
const word = (value) => String(value ?? "").trim();
export const isPublicProject = (project) =>
  project && (word(project.secrecy).toLowerCase() || "public") === "public";

// Native outcomes identify their canonical project by ID, so identical titles
// need not suppress a legitimate public milestone or expose a secret one.
// For legacy outcomes without IDs, accept only one owner-scoped title match.
export const publicProjectOutcomes = (outcomes, projects, host = "") =>
  list(outcomes).filter((outcome) => {
    const id = word(outcome?.projectId);
    const title = word(outcome?.project);
    const owner = word(outcome?.owner) || word(host);
    const belongsTo = (project) => {
      const actual = word(project?.ownerCode) || word(host);
      return !owner || Boolean(actual && sameName(actual, owner));
    };
    if (id) {
      const target = list(projects).find((project) => word(project?.id) === id);
      return Boolean(target && (!title || sameName(target.name, title))
        && belongsTo(target) && isPublicProject(target));
    }
    if (!title || !owner) return false;
    const matches = list(projects).filter((project) =>
      word(project?.name) && sameName(project.name, title) && belongsTo(project));
    return matches.length === 1 && isPublicProject(matches[0]);
  });
