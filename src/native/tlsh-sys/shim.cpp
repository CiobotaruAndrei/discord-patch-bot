#include "tlsh.h"

extern "C" int discord_patch_bot_tlsh_digest(
    const unsigned char *data, unsigned int len, char *out, unsigned int out_len) {
  if (data == 0 || out == 0 || out_len < TLSH_STRING_LEN_REQ + 1) {
    return -1;
  }
  Tlsh hash;
  hash.final(data, len, 0);
  if (!hash.isValid()) {
    return 1;
  }
  return hash.getHash(out, out_len, 1) == 0 ? -1 : 0;
}

extern "C" int discord_patch_bot_tlsh_diff(const char *left, const char *right) {
  if (left == 0 || right == 0) {
    return -1;
  }
  Tlsh a;
  Tlsh b;
  if (a.fromTlshStr(left) != 0 || b.fromTlshStr(right) != 0) {
    return -1;
  }
  return a.totalDiff(&b, true);
}

extern "C" unsigned int discord_patch_bot_tlsh_min_length(void) {
  return MIN_DATA_LENGTH;
}

extern "C" unsigned int discord_patch_bot_tlsh_digest_len(void) {
  return TLSH_STRING_LEN_REQ;
}
