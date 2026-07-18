"use strict";

export type SourceFetcher<T> = () => Promise<T>;
export type SourceDecoder<Raw, Decoded> = (raw: Raw) => Decoded;

export async function fetchDecodeNormalize<Raw, Decoded, Domain>(
  fetch: SourceFetcher<Raw>,
  decode: SourceDecoder<Raw, Decoded>,
  normalize: (decoded: Decoded) => Domain
): Promise<Domain> {
  const raw = await fetch();
  return normalize(decode(raw));
}
