export const INSTRUMENT_SYMBOLS: readonly string[] = [
  'ALFA', 'BETA', 'GAMA', 'DLTA', 'EPSI', 'ZETA', 'ETAX', 'THTA', 'IOTA', 'KAPA',
  'LMDA', 'MUXX', 'NUXX', 'XIXX', 'OMCR', 'PIXX', 'RHOX', 'SGMA', 'TAUX', 'UPSL',
  'PHIX', 'CHIX', 'PSIX', 'OMGA', 'ECHO', 'GOLF', 'KILO', 'LIMA', 'MIKE', 'OSCR',
  'PAPA', 'ROMO', 'TNGO', 'VICT', 'XRAY', 'YANK', 'ZULU', 'ORIN', 'VEGA', 'LYRA',
  'NOVA', 'ATLS', 'CRUX', 'DRCO', 'PYXS', 'HYDR', 'CETI', 'AURA', 'RIGL', 'SOLR',
];

export function symbolFor(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= INSTRUMENT_SYMBOLS.length) {
    throw new RangeError(`Instrument index out of range: ${index}`);
  }
  return INSTRUMENT_SYMBOLS[index];
}

export function symbolsFor(count: number): string[] {
  return INSTRUMENT_SYMBOLS.slice(0, count);
}
