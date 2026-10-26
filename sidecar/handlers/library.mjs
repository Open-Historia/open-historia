import fs from "node:fs";

export const register = (ctx) => {
  const { engine, clean, list } = ctx;
  const lib = engine.library;

  const bytesOf = (file) => {
    const buffer = fs.readFileSync(clean(file));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };

  return {
    "library.archive": async ({ id, archived }) => {
      await lib.saveGame(clean(id), { archived: archived === true });
      return true;
    },
    "library.delete": async ({ id }) => {
      await lib.removeGame(clean(id));
      return true;
    },
    "library.trash": async () => {
      try {
        const trash = await lib.listTrash();
        return {
          entries: list(trash?.entries).map((entry) => ({
            entry: clean(entry?.entry),
            kind: clean(entry?.kind),
            id: clean(entry?.id),
            name: clean(entry?.name),
            deletedAt: clean(entry?.deletedAt),
            bytes: Number(entry?.bytes) || 0,
          })),
          keepDays: Number(trash?.keepDays) || 0,
          keepCount: Number(trash?.keepCount) || 0,
        };
      } catch {
        return null;
      }
    },
    "library.restore": async ({ entry }) => {
      await lib.restoreFromTrash(clean(entry));
      return true;
    },
    "library.emptyTrash": async ({ kind }) => {
      await lib.emptyTrash(clean(kind));
      return true;
    },
    "library.cloneGame": async ({ id, name }) => {
      await lib.createGame({ name: `${clean(name)} Copy`, seedGameId: clean(id), setActive: true });
      return true;
    },
    "library.exportGame": async ({ id, path: target, carry = null }) => {
      let question = null;
      const result = await engine.gameZip.buildGameZipBlob(clean(id), {
        confirmCarryingScenario: ({ bytes, name }) => {
          if (carry === true) return true;
          question = { name: clean(name), size: engine.gameZip.formatZipSize(bytes) };
          return false;
        },
      });
      if (!result) {
        return question && carry === null
          ? { ask: `“${question.name}” isn't a scenario the other machine can download, so the map has to travel inside this file — about ${question.size} before it is compressed.\n\nExport it?` }
          : { cancelled: true };
      }
      fs.writeFileSync(clean(target), Buffer.from(await result.blob.arrayBuffer()));
      const oversize = result.oversizeScenario;
      return {
        saved: clean(target),
        note: oversize
          ? `“${oversize.name}” is ${engine.gameZip.formatZipSize(oversize.bytes)} — too large to travel inside a game file, so this export carries everything except the map. Send the scenario separately from the Scenarios tab.`
          : "",
      };
    },
    "library.importGame": async ({ path: source }) => {
      const buffer = bytesOf(source);
      if (!engine.bundleZip.looksLikeZip(new Uint8Array(buffer))) {
        throw new Error("That file isn't a game export. Pick the .zip you saved with Export.");
      }
      const { bundle, scenarioBundle, snapshotsText } = await engine.gameZip.readGameZip(buffer);
      let scenarioId = bundle.scenarioRef?.scenarioId ?? "";
      if (scenarioBundle) {
        const catalog = engine.getLibraryState();
        scenarioId = await engine.importedScenarioCopy.findScenarioCopyOfBundle(scenarioBundle, list(catalog?.scenarios), lib.loadScenarioDetails)
          ?? (await lib.importScenarioBundle(scenarioBundle)).scenario.id;
      }
      const details = await lib.importGameBundle({ ...bundle, scenarioRef: { ...(bundle.scenarioRef ?? {}), scenarioId } });
      if (snapshotsText) await lib.writeGameSnapshotsText(details.game.id, snapshotsText);
      await engine.refreshLibraryCatalog({ force: true });
      return { id: clean(details.game.id) };
    },
    "library.importScenario": async ({ path: source }) => {
      const bundle = await engine.hubPosts.readScenarioBundleBytes(bytesOf(source));
      const details = await lib.importScenarioBundle(bundle);
      engine.missingBasemap.noteMissingBasemapTried(details.scenario);
      const missing = engine.communityBasemaps.unresolvedBundleBackground(bundle);
      await engine.refreshLibraryCatalog({ force: true });
      return {
        id: clean(details.scenario.id),
        note: missing ? `The scenario was imported, but its community basemap could not be downloaded. ${missing} The game tries again the next time you start it and open the scenario.` : "",
      };
    },
  };
};
