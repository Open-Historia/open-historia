import test from "node:test";
import assert from "node:assert/strict";

import { deriveWorldExplorationAudit } from "./nativeWorldIntegrity.js";

const makeLargeWorld = () => {
  const entries = Object.fromEntries(
    Array.from({ length: 295 }, (_, index) => [
      `Polity ${index}`,
      {
        name: `Polity ${index}`,
        aliases: [`P${index}`],
        status: "active",
      },
    ]),
  );

  let polityEnumerationCount = 0;
  const polityOverrides = new Proxy(entries, {
    ownKeys(target) {
      polityEnumerationCount += 1;
      return Reflect.ownKeys(target);
    },
  });

  const regionOwnershipOverrides = Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => [
      `region-${index}`,
      `Polity ${index % 295}`,
    ]),
  );

  return {
    world: {
      polityOverrides,
      regionOwnershipOverrides,
      wars: [],
      relations: [],
      agreements: [],
      storylines: [],
    },
    polityEnumerationCount: () => polityEnumerationCount,
  };
};

test("world exploration audit builds the polity alias catalogue once per audit", () => {
  const { world, polityEnumerationCount } = makeLargeWorld();

  const events = Array.from({ length: 10 }, (_, index) => ({
    title: `Polity ${index} signs pact with Polity ${index + 1}`,
    description: `P${index} and P${index + 1} hold cross-border talks.`,
    impacts: { createdChats: [] },
  }));

  const analysis = {
    explorationSlate: [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        type: "actor-domain",
        actor: `Polity ${index}`,
        domain: "economy",
      })),
      { id: 9, type: "global", domain: "cross-border system" },
      { id: 10, type: "global", domain: "wider world" },
    ],
  };

  const audit = deriveWorldExplorationAudit(
    {
      events,
      storylineUpdates: "",
      diplomaticOutreach: [],
      warUpdates: "",
      relationUpdates: "",
      agreementUpdates: "",
    },
    analysis,
    {
      world,
      gameCountry: "Polity 0",
    },
  );

  assert.equal(audit.slotCount, 10);
  assert.equal(audit.nonQuietCount, 10);
  assert.deepEqual(audit.quietSlotIds, []);

  // `createWorldActorResolver()` enumerates polityOverrides while building one
  // resolver. The audit must reuse that resolver for every event/slot instead of
  // rebuilding the full alias catalogue for every actor probe.
  assert.ok(
    polityEnumerationCount() <= 4,
    `expected one bounded alias-catalogue build, saw ${polityEnumerationCount()} polity enumerations`,
  );
});
