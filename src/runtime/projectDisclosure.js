// One narrow public-event boundary for the Projects engine. The engine still
// simulates every project; only public entries may be automatically narrated as
// milestones/completions. Exposures must arise from a separate, authorized
// intelligence/event source, not an omniscient project forecast.
import { sameName } from "../../server/nameKey.js";

const list = (value) => (Array.isArray(value) ? value : []);
const word = (value) => String(value ?? "").trim();
export const isPublicProject = (project) =>
  project && (word(project.secrecy).toLowerCase() || "public") === "public";

// Outcomes use project names and owners, not IDs. A name that could identify
// several canonical entries is deliberately not eligible for public narration.
export const publicProjectOutcomes = (outcomes, projects, host = "") =>
  list(outcomes).filter((outcome) => {
    const title = word(outcome?.project);
    const owner = word(outcome?.owner) || word(host);
    if (!title || !owner) return false;
    const matches = list(projects).filter((project) => {
      const projectOwner = word(project?.ownerCode) || word(host);
      return word(project?.name) && sameName(project.name, title)
        && projectOwner && sameName(projectOwner, owner);
    });
    return matches.length === 1 && isPublicProject(matches[0]);
  });
