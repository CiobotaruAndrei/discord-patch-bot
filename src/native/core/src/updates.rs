pub fn is_good_steam_article_url(url: &str) -> bool {
  let v = url.trim().to_lowercase();
  if v.is_empty() { return false; }
  if !v.starts_with("http") { return false; }
  if v.contains("steamstatic") { return false; }
  if v.contains("steamcdn") { return false; }
  true
}

pub fn extract_date_score(url: &str) -> f64 {
  let bytes = url.as_bytes();
  if bytes.len() < 10 { return 0.0; }
  let max_start = bytes.len() - 10;
  let mut i = 0usize;
  while i <= max_start {
    if !bytes[i].is_ascii_digit() {
      i += 1;
      continue;
    }
    if bytes[i + 1].is_ascii_digit()
      && bytes[i + 2].is_ascii_digit()
      && bytes[i + 3].is_ascii_digit()
      && (bytes[i + 4] == b'-' || bytes[i + 4] == b'/')
      && bytes[i + 5].is_ascii_digit()
      && bytes[i + 6].is_ascii_digit()
      && (bytes[i + 7] == b'-' || bytes[i + 7] == b'/')
      && bytes[i + 8].is_ascii_digit()
      && bytes[i + 9].is_ascii_digit()
    {
      let year  = (bytes[i]     - b'0') as i32 * 1000
                + (bytes[i + 1] - b'0') as i32 * 100
                + (bytes[i + 2] - b'0') as i32 * 10
                + (bytes[i + 3] - b'0') as i32;
      let month = (bytes[i + 5] - b'0') as i32 * 10
                + (bytes[i + 6] - b'0') as i32;
      let day   = (bytes[i + 8] - b'0') as i32 * 10
                + (bytes[i + 9] - b'0') as i32;
      if (2000..=2100).contains(&year)
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
      {
        if let Some(ts) = utc_ms_for_date(year, month as u32, day as u32) {
          return ts;
        }
      }
    }
    i += 1;
  }
  0.0
}

fn utc_ms_for_date(year: i32, month: u32, day: u32) -> Option<f64> {
  let max_day = match month {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    2 => if is_leap_year(year) { 29 } else { 28 },
    _ => return None,
  };
  if day == 0 || day > max_day { return None; }
  Some(days_from_civil(year, month, day) as f64 * 86_400_000.0)
}

fn is_leap_year(year: i32) -> bool {
  (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
  let y = if month <= 2 { year - 1 } else { year } as i64;
  let era = (if y >= 0 { y } else { y - 399 }) / 400;
  let yoe = (y - era * 400) as u32;
  let m = month as i64;
  let doy = ((153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1) as u32;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe as i64 - 719_468
}

const BAD_IN_TITLE: &[&str] = &[
  "community", "sale", "store", "merch", "tournament", "esports",
  "giveaway", "teaser", "trailer", "preview", "announce", "announcement",
];
const GOOD_WORDS: &[&str] = &[
  "update", "patch", "hotfix", "version", "release", "bugfix", "bug fix",
  "fixes", "fix", "notes", "patch notes", "changelog", "maintenance",
  "build", "client update", "title update", "release notes", "season",
  "chapter", "rework", "balance", "content update", "launch",
];

pub fn classify_patch_note(title: &str, contents: &str, tags: &[String]) -> bool {
  let title_lc = title.to_lowercase();
  if BAD_IN_TITLE.iter().any(|w| title_lc.contains(w)) {
    return false;
  }
  let has_patch_tag = tags.iter().any(|t| {
    let lc = t.to_lowercase();
    lc == "patchnotes" || lc == "update"
  });
  if has_patch_tag {
    return true;
  }
  let contents_lc = contents.to_lowercase();
  GOOD_WORDS.iter().any(|w| title_lc.contains(w) || contents_lc.contains(w))
}
