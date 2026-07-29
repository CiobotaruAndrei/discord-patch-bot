#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

void discord_patch_bot_mspack_message(void *file, const char *format, ...) {
  (void) file;
  (void) format;
}

void *discord_patch_bot_mspack_alloc(void *self, size_t bytes) {
  (void) self;
  return malloc(bytes);
}

void discord_patch_bot_mspack_free(void *ptr) {
  free(ptr);
}

void discord_patch_bot_mspack_copy(void *src, void *dest, size_t bytes) {
  memcpy(dest, src, bytes);
}
