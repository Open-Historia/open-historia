/*!
 * Open Historia Map Editor - one native OpenLayers Move tool with selected-
 * region group translation and unselected-region single translation.
 */
import Collection from "ol/Collection.js";
import Translate from "ol/interaction/Translate.js";
import { trackMove } from "./shapeEdits.js";
import { selectedMoveFeatures } from "./regionSelectionTools.js";

export const regionMoveInteractions = ({
  source, layer, selectionIds = [], selectedIdsRef,
  onStep = () => {}, onRegionsChanged = () => {},
}) => {
  const selected = new Collection(selectedMoveFeatures(source, selectionIds));
  const singleMove = new Translate({
    layers: [layer], hitTolerance: 2,
    filter: (feature) => !selectedIdsRef.current.has(feature.getId()),
  });
  const groupMove = new Translate({ features: selected, hitTolerance: 2 });

  const wire = (interaction) => {
    const move = trackMove();
    interaction.on("translatestart", (e) => move.start(e.features.getArray(), e.startCoordinate));
    interaction.on("translateend", (e) => {
      const cmd = move.end(e.features.getArray(), e.coordinate);
      if (cmd) onStep(cmd);
      onRegionsChanged();
    });
  };
  wire(singleMove);
  wire(groupMove);

  // These are installed in this order: OpenLayers processes the latest
  // interaction first. Group movement therefore claims selected pointer hits,
  // while drags on unselected regions pass to the single-region interaction.
  return [singleMove, groupMove];
};
