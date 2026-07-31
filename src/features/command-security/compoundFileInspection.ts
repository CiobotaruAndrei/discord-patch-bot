"use strict";

const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FREE_SECT = 0xffffffff;
const CFB_MAX_FAT_SECTORS = 512;
const CFB_MAX_DIR_ENTRIES = 4096;

export function isCompoundFileBinary(buffer: Buffer): boolean {
  return buffer.length >= 512 && buffer.readUInt32BE(0) === 0xd0cf11e0 && buffer.readUInt32BE(4) === 0xa1b11ae1;
}

export function inspectCompoundFileBinary(buffer: Buffer): string[] {
  if (!isCompoundFileBinary(buffer)) return [];
  const indicators: string[] = [];
  try {
    const sectorShift = buffer.readUInt16LE(30);
    if (sectorShift !== 9 && sectorShift !== 12) return indicators;
    const sectorSize = 1 << sectorShift;
    const sectorOffset = (sector: number): number => 512 + sector * sectorSize;
    const entriesPerFatSector = sectorSize / 4;
    const fat: number[] = [];
    const declaredFatSectors = buffer.readUInt32LE(44);
    const fatSectorCount = Math.min(declaredFatSectors, 109, CFB_MAX_FAT_SECTORS);
    for (let i = 0; i < fatSectorCount; i++) {
      const fatSector = buffer.readUInt32LE(76 + i * 4);
      if (fatSector === CFB_FREE_SECT || fatSector === CFB_END_OF_CHAIN) break;
      const base = sectorOffset(fatSector);
      if (base + sectorSize > buffer.length) break;
      for (let j = 0; j < entriesPerFatSector; j++) fat.push(buffer.readUInt32LE(base + j * 4));
    }
    const entriesPerDirSector = Math.floor(sectorSize / 128);
    const visited = new Set<number>();
    let sector = buffer.readUInt32LE(48);
    let inspectedEntries = 0;
    while (sector !== CFB_END_OF_CHAIN && sector !== CFB_FREE_SECT && !visited.has(sector) && inspectedEntries < CFB_MAX_DIR_ENTRIES) {
      visited.add(sector);
      const base = sectorOffset(sector);
      if (base + sectorSize > buffer.length) break;
      for (let e = 0; e < entriesPerDirSector && inspectedEntries < CFB_MAX_DIR_ENTRIES; e++, inspectedEntries++) {
        const entryOffset = base + e * 128;
        const objectType = buffer.readUInt8(entryOffset + 66);
        if (objectType !== 1 && objectType !== 2 && objectType !== 5) continue;
        const nameLength = buffer.readUInt16LE(entryOffset + 64);
        if (nameLength < 4 || nameLength > 64) continue;
        const name = buffer.subarray(entryOffset, entryOffset + nameLength - 2).toString("utf16le");
        const normalized = name.toLowerCase();
        if (normalized === "macros" || normalized === "vba" || normalized === "_vba_project" || normalized === "vbaproject") {
          indicators.push("macro VBA in document OLE (parser structural CFB)");
        }
        if (normalized === "ole10native" || normalized === "objectpool" || normalized === "package") {
          indicators.push("obiect OLE incorporat in document OLE (parser structural CFB)");
        }
      }
      sector = sector < fat.length ? fat[sector] : CFB_END_OF_CHAIN;
    }
  } catch {
    return [...new Set(indicators)];
  }
  return [...new Set(indicators)];
}
