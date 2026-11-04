import { CastleFalkensteinItemDataModel } from "./item-datamodel.mjs";
import { CASTLE_FALKENSTEIN } from "../config.mjs";

export class CastleFalkensteinSpellDataModel extends CastleFalkensteinItemDataModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      level: new foundry.data.fields.NumberField({label: "castle-falkenstein.spell.thaumicLevel", initial: 0}),
      suit: new foundry.data.fields.StringField({label: "castle-falkenstein.spell.aspect", initial: "?"})
    }
  }

  get suitSymbol() {
    return CASTLE_FALKENSTEIN.cardSuitsSymbols[this.suit];
  }
}
