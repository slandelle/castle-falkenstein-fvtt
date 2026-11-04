import { CASTLE_FALKENSTEIN } from "../config.mjs";
import { CastleFalkenstein } from "../castle-falkenstein.mjs";

/**
 * Sheet for the 'possession' item type.
 * @extends {ItemSheet}
 */
export class CastleFalkensteinPossessionSheet extends foundry.appv1.sheets.ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [CastleFalkenstein.id, "sheet", "item"],
      template: "systems/castle-falkenstein/src/documents/item-sheet-possession.hbs",
      width: 460,
      height: 300,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    // convenience so context and name/target are aligned for system properties
    context.system = context.item.system;
    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(context.system.description);
    context.CASTLE_FALKENSTEIN = CASTLE_FALKENSTEIN;
    return context;
  }


}
