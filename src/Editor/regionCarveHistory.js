/*!
 * Map Editor - exact restoration of an existing region's export dirty flag.
 * A region with an explicitly false flag is different from one without it.
 */
export const restoreCarvedEdited = (feature, previous) => {
  if (previous === undefined) feature.unset("edited", true);
  else feature.set("edited", previous, true);
};
