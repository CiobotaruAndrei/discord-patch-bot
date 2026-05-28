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

function attachDealFilters(target: DealFiltersContext): void {
  Object.assign(target, dealFilterExports);
}

const attachDealFiltersWithExports = Object.assign(attachDealFilters, dealFilterExports);

export = attachDealFiltersWithExports;
