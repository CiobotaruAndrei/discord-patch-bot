import {
  dealPassesFilters,
  getSeenSet,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "./filtersCore";

type DealFiltersContext = Record<string, unknown>;

const dealFilterExports = {
  dealPassesFilters,
  normalizePendingUpdateArray,
  normalizePendingDiscountArray,
  toEntries,
  mapToObject,
  getSeenSet,
  rotateAfter
};

function attachDealFilters(ctx: DealFiltersContext): void {
  Object.assign(ctx, dealFilterExports);
}

const attachDealFiltersWithExports = Object.assign(attachDealFilters, dealFilterExports);

export = attachDealFiltersWithExports;
