/* ==========================================================================
   ELEV8 — création d'une archive ZIP en mémoire (aucune dépendance)
   Format ZIP standard (compression « deflate »), lisible par Windows, macOS et Excel.
   ========================================================================== */
import { deflateRawSync } from "node:zlib";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/* Date et heure au format DOS (heure locale de Paris) */
function dateDos(ms) {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = +x.value; });
  return { heure: (p.hour << 11) | (p.minute << 5) | (p.second >> 1), jour: ((p.year - 1980) << 9) | (p.month << 5) | p.day };
}

/* fichiers : [{ nom, contenu (Buffer | Uint8Array | string) }] → Buffer */
export function creerZip(fichiers, now = Date.now()) {
  const { heure, jour } = dateDos(now);
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, "utf8");
    const brut = Buffer.isBuffer(f.contenu) ? f.contenu : Buffer.from(f.contenu);
    const comp = deflateRawSync(brut, { level: 9 });
    const crc = crc32(brut);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(heure, 10); l.writeUInt16LE(jour, 12); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(brut.length, 22); l.writeUInt16LE(nom.length, 26); l.writeUInt16LE(0, 28);
    locaux.push(l, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(heure, 12); c.writeUInt16LE(jour, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(brut.length, 24); c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(decalage, 42);
    centraux.push(c, nom);
    decalage += 30 + nom.length + comp.length;
  }
  const central = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, central, fin]);
}
