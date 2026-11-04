import { CastleFalkenstein } from "../castle-falkenstein.mjs";

/**
 * Sheet for the Cards Deck.
 * @extends {CardDeckConfig}
 */
export class CastleFalkensteinDeckSheet extends foundry.applications.sheets.CardDeckConfig {

  /** @override */
  async _prepareContext(options) {
    // translate card names (in memory only) before the core sheet prepares its card list
    CastleFalkenstein.translateCardStack(this.document);

    return super._prepareContext(options);
  }
}
