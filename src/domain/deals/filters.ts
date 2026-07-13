import {
  dealPassesFilters,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "./filtersCore.js";

const dealFilterExports = {
  dealPassesFilters,
  normalizePendingUpdateArray,
  normalizePendingDiscountArray,
  toEntries,
  mapToObject,
  rotateAfter
};

type DealFiltersContext = Partial<typeof dealFilterExports>;

function attachDealFilters(target: DealFiltersContext): void {
  Object.assign(target, dealFilterExports);
}

const attachDealFiltersWithExports = Object.assign(attachDealFilters, dealFilterExports);

export default attachDealFiltersWithExports;
