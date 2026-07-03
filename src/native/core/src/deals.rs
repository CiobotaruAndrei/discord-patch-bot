#[allow(clippy::too_many_arguments)]
pub fn deal_passes_filters(
  sale_price_num: f64,
  savings_num: f64,
  store: &str,
  min_discount_percent: f64,
  include_free_games: bool,
  include_paid_discounts: bool,
  max_absolute_price: f64,
  enabled_stores: &[String],
) -> bool {
  let is_free = sale_price_num == 0.0;
  if is_free && !include_free_games {
    return false;
  }
  if !is_free && !include_paid_discounts {
    return false;
  }
  if !is_free && (!savings_num.is_finite() || savings_num < min_discount_percent) {
    return false;
  }
  if !is_free
    && max_absolute_price > 0.0
    && sale_price_num.is_finite()
    && sale_price_num > max_absolute_price
  {
    return false;
  }
  if !enabled_stores.is_empty() && !enabled_stores.iter().any(|candidate| candidate == store) {
    return false;
  }
  true
}
