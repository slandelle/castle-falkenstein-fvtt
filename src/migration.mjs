import { CastleFalkenstein } from "./castle-falkenstein.mjs";

/**
 * One-time migration of worlds created with the original `castle-falkenstein` system (or with v4.0.0 of this fork,
 * which still wrote its flags under that id): settings, document flags and image paths are moved to this system's id,
 * and the duplicate diaries, hands, folders and decks created meanwhile because the originals could not be found are
 * merged back into them.
 */

const OLD_ID = "castle-falkenstein";
const OLD_PATH = `systems/${OLD_ID}/`;
const DONE_SETTING = "originalSystemMigrationDone";

export async function migrateFromOriginalSystem() {
  game.settings.register(CastleFalkenstein.id, DONE_SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  if (!game.user.isGM || game.settings.get(CastleFalkenstein.id, DONE_SETTING))
    return;

  try {
    const createdWithNewId = documentsFlaggedOnlyWithNewId();
    const recreatedDecks = await migrateSettings();
    await migrateFlags();
    await migrateImagePaths();
    await mergeDuplicates(createdWithNewId);
    await deleteRecreatedDecks(recreatedDecks);
    await game.settings.set(CastleFalkenstein.id, DONE_SETTING, true);
  } catch (err) {
    CastleFalkenstein.log.error(err);
  }
}

const newId = () => CastleFalkenstein.id;

const hasOldFlags = (doc) => doc._source.flags?.[OLD_ID] !== undefined;
const hasNewFlags = (doc) => doc._source.flags?.[newId()] !== undefined;

/**
 * Hands, diaries and folders flagged only with the new id were created by v4.0.0/v4.0.1 when the original ones
 * (flagged with the old id) could not be found.
 */
function documentsFlaggedOnlyWithNewId() {
  const ids = new Set();
  for (const collection of [game.cards, game.journal, game.folders]) {
    for (const doc of collection) {
      if (hasNewFlags(doc) && !hasOldFlags(doc))
        ids.add(doc.uuid);
    }
  }
  return ids;
}

function parseSettingValue(raw) {
  if (typeof raw !== "string")
    return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * @returns the decks recreated by v4.0.0/v4.0.1, now replaced by the original ones
 */
async function migrateSettings() {
  const recreatedDecks = [];
  const worldSettings = game.settings.storage.get("world");
  const findWorldSetting = (namespace, key) => worldSettings.find(s => s.key === `${namespace}.${key}`);

  for (const config of game.settings.settings.values()) {
    if (config.namespace !== newId() || config.key === DONE_SETTING)
      continue;

    if (config.scope === "client") {
      const oldValue = localStorage.getItem(`${OLD_ID}.${config.key}`);
      if (oldValue !== null && localStorage.getItem(`${newId()}.${config.key}`) === null)
        localStorage.setItem(`${newId()}.${config.key}`, oldValue);
      continue;
    }

    if (config.scope !== "world")
      continue;

    const oldSetting = findWorldSetting(OLD_ID, config.key);
    if (!oldSetting)
      continue;
    const oldValue = parseSettingValue(oldSetting._source.value);

    let migrate = !findWorldSetting(newId(), config.key);
    if (["fortuneDeck", "sorceryDeck"].includes(config.key)) {
      // the decks recreated since are replaced by the original ones, which the existing hands draw from
      migrate = !!game.cards.get(oldValue) && oldValue !== game.settings.get(newId(), config.key);
      if (migrate) {
        const recreatedDeck = game.cards.get(game.settings.get(newId(), config.key));
        CastleFalkenstein.log.info(`Migrating setting '${config.key}' from the '${OLD_ID}' system`);
        await game.settings.set(newId(), config.key, oldValue);
        if (recreatedDeck)
          recreatedDecks.push(recreatedDeck);
        continue;
      }
    }

    if (migrate) {
      CastleFalkenstein.log.info(`Migrating setting '${config.key}' from the '${OLD_ID}' system`);
      await game.settings.set(newId(), config.key, oldValue);
    }
  }

  return recreatedDecks;
}

/**
 * Deletes the recreated decks once the duplicate hands have returned their cards, unless some of their cards are
 * still in other stacks.
 */
async function deleteRecreatedDecks(recreatedDecks) {
  for (const deck of recreatedDecks) {
    if (deck.drawnCards.length === 0) {
      CastleFalkenstein.log.info(`Deleting duplicate deck '${deck.name}' (${deck.id})`);
      await deck.delete();
    } else {
      CastleFalkenstein.log.warn(`Duplicate deck '${deck.name}' (${deck.id}) kept, as some of its cards are still drawn`);
    }
  }
}

/**
 * Copies the flags of the old scope into the new one. Values already in the new scope win, as they are more recent
 * (v4.0.0 already used the new id when updating flags of existing documents).
 */
function flagsUpdate(doc) {
  if (!hasOldFlags(doc))
    return null;
  const flags = foundry.utils.mergeObject(
    foundry.utils.deepClone(doc._source.flags[OLD_ID]),
    doc._source.flags[newId()] ?? {},
    { inplace: false }
  );
  return { _id: doc.id, [`flags.${newId()}`]: flags };
}

async function migrateFlags() {
  const worldCollections = [
    [Folder, game.folders],
    [JournalEntry, game.journal],
    [Cards, game.cards],
    [ChatMessage, game.messages],
    [Actor, game.actors],
    [Item, game.items]
  ];

  for (const [documentClass, collection] of worldCollections) {
    const updates = collection.map(flagsUpdate).filter(u => u);
    if (updates.length > 0) {
      CastleFalkenstein.log.info(`Migrating flags of ${updates.length} ${documentClass.documentName} documents from the '${OLD_ID}' system`);
      await documentClass.updateDocuments(updates);
    }
  }

  for (const stack of game.cards) {
    const updates = stack.cards.map(flagsUpdate).filter(u => u);
    if (updates.length > 0)
      await stack.updateEmbeddedDocuments("Card", updates);
  }
}

const fixPath = (path) => (typeof path === "string" && path.startsWith(OLD_PATH)) ? `systems/${newId()}/${path.slice(OLD_PATH.length)}` : path;

async function migrateImagePaths() {
  const imgUpdates = (docs) => docs.filter(d => fixPath(d._source.img) !== d._source.img)
                                   .map(d => ({ _id: d.id, img: fixPath(d._source.img) }));

  const itemUpdates = imgUpdates(game.items);
  if (itemUpdates.length > 0)
    await Item.updateDocuments(itemUpdates);

  const macroUpdates = imgUpdates(game.macros);
  if (macroUpdates.length > 0)
    await Macro.updateDocuments(macroUpdates);

  const actorUpdates = game.actors.map(actor => {
    const update = {};
    if (fixPath(actor._source.img) !== actor._source.img)
      update.img = fixPath(actor._source.img);
    const tokenSrc = actor._source.prototypeToken?.texture?.src;
    if (fixPath(tokenSrc) !== tokenSrc)
      update["prototypeToken.texture.src"] = fixPath(tokenSrc);
    return foundry.utils.isEmpty(update) ? null : { _id: actor.id, ...update };
  }).filter(u => u);
  if (actorUpdates.length > 0)
    await Actor.updateDocuments(actorUpdates);

  for (const actor of game.actors) {
    const updates = imgUpdates(actor.items);
    if (updates.length > 0)
      await actor.updateEmbeddedDocuments("Item", updates);
  }

  const stackUpdates = imgUpdates(game.cards);
  if (stackUpdates.length > 0)
    await Cards.updateDocuments(stackUpdates);

  for (const stack of game.cards) {
    const updates = stack.cards.map(card => {
      const src = card._source;
      const faces = src.faces.map(face => ({ ...face, img: fixPath(face.img) }));
      const back = { ...src.back, img: fixPath(src.back?.img) };
      const changed = faces.some((face, i) => face.img !== src.faces[i].img) || back.img !== src.back?.img;
      return changed ? { _id: card.id, faces, back } : null;
    }).filter(u => u);
    if (updates.length > 0) {
      CastleFalkenstein.log.info(`Migrating image paths of ${updates.length} cards in '${stack.name}'`);
      await stack.updateEmbeddedDocuments("Card", updates);
    }
  }
}

/**
 * Merges each hand, diary or folder created by v4.0.0/v4.0.1 into the original one it duplicates.
 */
async function mergeDuplicates(createdWithNewId) {
  const isDuplicate = (doc) => createdWithNewId.has(doc.uuid);
  const flag = (doc, key) => doc._source.flags?.[newId()]?.[key];

  // Hands: cards drawn into a duplicate hand go back to their deck.
  for (const duplicate of game.cards.filter(stack => stack.type === "hand" && isDuplicate(stack))) {
    const original = game.cards.find(stack => stack.type === "hand" && !isDuplicate(stack) &&
      flag(stack, "type") === flag(duplicate, "type") && flag(stack, "actor") === flag(duplicate, "actor"));
    if (!original)
      continue;
    CastleFalkenstein.log.info(`Deleting duplicate hand '${duplicate.name}' (${duplicate.id})`);
    if (duplicate.cards.size > 0)
      await duplicate.recall({ chatNotification: false });
    await duplicate.delete();
  }

  // Diaries: pages written in a duplicate diary are moved to the original one.
  for (const duplicate of game.journal.filter(je => isDuplicate(je) && flag(je, "type") === "diary")) {
    const original = game.journal.find(je => !isDuplicate(je) && flag(je, "type") === "diary" && flag(je, "actor") === flag(duplicate, "actor"));
    if (!original)
      continue;
    CastleFalkenstein.log.info(`Merging duplicate diary '${duplicate.name}' (${duplicate.id}) into '${original.name}' (${original.id})`);
    if (duplicate.pages.size > 0) {
      const pages = duplicate.pages.map(page => {
        const data = page.toObject();
        delete data._id;
        return data;
      });
      await original.createEmbeddedDocuments("JournalEntryPage", pages);
    }
    await duplicate.delete();
  }

  // Folders: content and subfolders of a duplicate folder are moved to the original one.
  for (const duplicate of game.folders.filter(f => isDuplicate(f) && flag(f, "type"))) {
    const original = game.folders.find(f => !isDuplicate(f) && f.type === duplicate.type && flag(f, "type") === flag(duplicate, "type"));
    if (!original)
      continue;
    CastleFalkenstein.log.info(`Merging duplicate folder '${duplicate.name}' (${duplicate.id}) into '${original.name}' (${original.id})`);
    const documentClass = foundry.utils.getDocumentClass(duplicate.type);
    const contentUpdates = duplicate.contents.map(doc => ({ _id: doc.id, folder: original.id }));
    if (contentUpdates.length > 0)
      await documentClass.updateDocuments(contentUpdates);
    const subfolderUpdates = game.folders.filter(f => f.folder?.id === duplicate.id).map(f => ({ _id: f.id, folder: original.id }));
    if (subfolderUpdates.length > 0)
      await Folder.updateDocuments(subfolderUpdates);
    await duplicate.delete();
  }
}
