// Compiles the compendium packs from src/packs/yaml/*.yaml (multi-document YAML, one Item per document)
// into LevelDB packs in build/packs/<pack-name>/, as expected by FoundryVTT v13+.
//
// Usage: npm run build (from src/packs)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_SRC = path.join(__dirname, "yaml");
const PACKS_DST = path.resolve(__dirname, "../../build/packs");
const STATS_TIME = Date.UTC(2026, 10, 1);

function hash(str, len) {
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, len);
}

function prepareItem(item) {
  // supplement the definitions with some key properties
  if (item.type === "ability") {
    if (!item.system.level)
      item.system.level = "AV";
    if (!item.img)
      item.img = `systems/castle-falkenstein/src/cards/${item.system.suit}.svg`;
  } else if (item.type === "spell") {
    if (!item.img)
      item.img = `systems/castle-falkenstein/src/cards/${item.system.suit}.svg`;
  } else if (item.type === "weapon") {
    if (!item.img)
      item.img = "systems/castle-falkenstein/src/img/saber-and-pistol.png";
    item.system.ammunition = item.system.ammunition_max;
  }
}

async function buildPack(file) {
  const packName = path.basename(file, ".yaml");
  const items = yaml.loadAll(fs.readFileSync(path.join(PACKS_SRC, file), "utf8"));

  if (items.length > 999)
    throw new Error(`Too many items in pack ${packName}`);

  // Deterministic ids (13 chars from the pack name + 3 from the item index = 16 chars, Foundry's id length).
  // They must stay stable across builds: worlds reference compendium entries by id.
  const packHash = hash(packName, 13);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `cf-pack-${packName}-`));
  try {
    items.forEach((item, index) => {
      const counter = index + 1;
      prepareItem(item);
      item._id = packHash + String(counter).padStart(3, "0");
      item._key = `!items!${item._id}`;
      item.sort = counter * 100000; // CONST.SORT_INTEGER_DENSITY
      // Fixed timestamps (rather than Date.now()) so that rebuilding unchanged sources produces identical packs.
      item._stats = { createdTime: STATS_TIME, modifiedTime: STATS_TIME, systemId: "castle-falkenstein" };
      fs.writeFileSync(path.join(tmpDir, `${item._id}.json`), JSON.stringify(item));
    });

    const dest = path.join(PACKS_DST, packName);
    fs.rmSync(dest, { recursive: true, force: true });
    await compilePack(tmpDir, dest, { log: false });
    console.log(`Built ${packName} (${items.length} items)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const files = fs.readdirSync(PACKS_SRC).filter(f => f.endsWith(".yaml")).sort();
fs.mkdirSync(PACKS_DST, { recursive: true });
for (const file of files)
  await buildPack(file);
