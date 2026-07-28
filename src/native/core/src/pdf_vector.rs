pub struct VectorRasterLimits {
  pub max_rectangles: usize,
  pub max_pixels: u64,
  pub target_edge: u32
}

impl Default for VectorRasterLimits {
  fn default() -> Self {
    Self { max_rectangles: 40_000, max_pixels: 4_000_000, target_edge: 900 }
  }
}

pub struct VectorRaster {
  pub width: u32,
  pub height: u32,
  pub samples: Vec<u8>
}

struct Rectangle {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  dark: bool
}

fn cmyk_to_gray(cyan: f64, magenta: f64, yellow: f64, black: f64) -> f64 {
  let red = (1.0 - cyan) * (1.0 - black);
  let green = (1.0 - magenta) * (1.0 - black);
  let blue = (1.0 - yellow) * (1.0 - black);
  0.299 * red + 0.587 * green + 0.114 * blue
}

fn tail(numbers: &[f64], count: usize) -> Option<&[f64]> {
  if numbers.len() < count {
    return None;
  }
  Some(&numbers[numbers.len() - count..])
}

pub fn collect_filled_rectangles(content: &[u8], limits: &VectorRasterLimits) -> Vec<(f64, f64, f64, f64, bool)> {
  let text = String::from_utf8_lossy(content);
  let mut numbers: Vec<f64> = Vec::new();
  let mut pending: Vec<Rectangle> = Vec::new();
  let mut committed: Vec<Rectangle> = Vec::new();
  let mut gray = 0.0f64;

  for token in text.split_ascii_whitespace() {
    if let Ok(value) = token.parse::<f64>() {
      if numbers.len() >= 8 {
        numbers.remove(0);
      }
      numbers.push(value);
      continue;
    }
    match token {
      "re" => {
        if let Some(values) = tail(&numbers, 4) {
          if pending.len() < limits.max_rectangles {
            pending.push(Rectangle {
              x: values[0],
              y: values[1],
              width: values[2],
              height: values[3],
              dark: gray < 0.5
            });
          }
        }
      }
      "g" => {
        if let Some(values) = tail(&numbers, 1) {
          gray = values[0];
        }
      }
      "rg" => {
        if let Some(values) = tail(&numbers, 3) {
          gray = 0.299 * values[0] + 0.587 * values[1] + 0.114 * values[2];
        }
      }
      "k" => {
        if let Some(values) = tail(&numbers, 4) {
          gray = cmyk_to_gray(values[0], values[1], values[2], values[3]);
        }
      }
      "f" | "F" | "f*" | "b" | "b*" | "B" | "B*" => committed.append(&mut pending),
      "n" | "S" | "s" => pending.clear(),
      _ => {}
    }
    if token.parse::<f64>().is_err() {
      numbers.clear();
    }
  }

  committed
    .into_iter()
    .map(|entry| (entry.x, entry.y, entry.width, entry.height, entry.dark))
    .collect()
}

pub fn rasterize_filled_rectangles(content: &[u8], limits: &VectorRasterLimits) -> Option<VectorRaster> {
  let rectangles = collect_filled_rectangles(content, limits);
  if rectangles.len() < 16 {
    return None;
  }

  let mut min_x = f64::MAX;
  let mut min_y = f64::MAX;
  let mut max_x = f64::MIN;
  let mut max_y = f64::MIN;
  for (x, y, width, height, _) in &rectangles {
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
      return None;
    }
    min_x = min_x.min(x.min(x + width));
    min_y = min_y.min(y.min(y + height));
    max_x = max_x.max(x.max(x + width));
    max_y = max_y.max(y.max(y + height));
  }
  let span_x = max_x - min_x;
  let span_y = max_y - min_y;
  if span_x <= 0.0 || span_y <= 0.0 {
    return None;
  }

  let scale = f64::from(limits.target_edge) / span_x.max(span_y);
  let width = ((span_x * scale).ceil() as u32).max(1);
  let height = ((span_y * scale).ceil() as u32).max(1);
  if u64::from(width) * u64::from(height) > limits.max_pixels {
    return None;
  }

  let mut samples = vec![255u8; (width as usize) * (height as usize)];
  for (x, y, rect_width, rect_height, dark) in &rectangles {
    let left = ((x.min(x + rect_width) - min_x) * scale).floor().max(0.0) as u32;
    let right = ((x.max(x + rect_width) - min_x) * scale).ceil().max(0.0) as u32;
    let bottom = ((y.min(y + rect_height) - min_y) * scale).floor().max(0.0) as u32;
    let top = ((y.max(y + rect_height) - min_y) * scale).ceil().max(0.0) as u32;
    let value = if *dark { 0u8 } else { 255u8 };
    for row in bottom.min(height)..top.min(height) {
      let flipped = height - 1 - row.min(height - 1);
      let start = (flipped as usize) * (width as usize);
      for column in left.min(width)..right.min(width) {
        samples[start + column as usize] = value;
      }
    }
  }

  Some(VectorRaster { width, height, samples })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn dreptunghiurile_se_colecteaza_doar_dupa_un_operator_de_umplere() {
    let fara_umplere = b"0 0 10 10 re 20 0 10 10 re";
    assert!(collect_filled_rectangles(fara_umplere, &VectorRasterLimits::default()).is_empty());

    let cu_umplere = b"0 0 10 10 re 20 0 10 10 re f";
    assert_eq!(collect_filled_rectangles(cu_umplere, &VectorRasterLimits::default()).len(), 2);
  }

  #[test]
  fn culoarea_de_umplere_decide_daca_un_modul_e_intunecat() {
    let alb = collect_filled_rectangles(b"1 g 0 0 10 10 re f", &VectorRasterLimits::default());
    assert_eq!(alb.len(), 1);
    assert!(!alb[0].4, "un dreptunghi alb nu e modul intunecat");

    let negru = collect_filled_rectangles(b"0 g 0 0 10 10 re f", &VectorRasterLimits::default());
    assert!(negru[0].4, "un dreptunghi negru e modul intunecat");
  }

  #[test]
  fn un_traseu_abandonat_nu_lasa_dreptunghiuri_in_urma() {
    let abandonat = b"0 0 10 10 re n 20 0 10 10 re f";
    assert_eq!(collect_filled_rectangles(abandonat, &VectorRasterLimits::default()).len(), 1);
  }
}
