pub const LABELED_CORPUS_VERSION: u32 = 2;

pub struct LabeledSample {
  pub id: &'static str,
  pub category: &'static str,
  pub hostile: bool,
  pub sha256: &'static str,
  pub fuzzy: &'static str
}

pub const LABELED_CORPUS: &[LabeledSample] = &[
  LabeledSample { id: "arhiva-zip-benigna", category: "arhiva", hostile: false, sha256: "2848dc7f83ecb9d76b68e339937b414e28052c9a3f6e39d12cae3715593197c6", fuzzy: "T1F8B02136C44A1085F1816131C0561013C010C025985FC40B26D89F53008D4CC5094548" },
  LabeledSample { id: "arhiva-zip-cu-executabil", category: "arhiva", hostile: true, sha256: "649b658906fc333a9d7c7cc784b07205992ba6378c471734656c9a7d7d14858b", fuzzy: "T149A02016FB0A0111DA278A37203F40A75E5333D121945656A96514259C865C847755C2" },
  LabeledSample { id: "arhiva-zip-imbricata-cu-executabil", category: "arhiva", hostile: true, sha256: "f5634337366c804944477bedc47bc69b50271f275579e59140654c92e3ce931a", fuzzy: "T17BB02115D8354CB0C011C1B0001009939403836428C6C6074104C20401590DCDDD655A" },
  LabeledSample { id: "arhiva-zip-criptata", category: "arhiva", hostile: true, sha256: "d1756607423b47599e367135135a02eb5d9d4bfd3e655fd3846415c8508b64c0", fuzzy: "" },
  LabeledSample { id: "arhiva-zip-bomba-de-compresie", category: "arhiva", hostile: true, sha256: "5b60a0fa1ffed520736f10f29d2cb23129e533d78ac9717fc14794a605d4fa4e", fuzzy: "T1F4314073453C5030D135C03FC1C7447F507040D5D311041D535450D05DD1CC503055D5" },
  LabeledSample { id: "arhiva-tar-office-cu-macro", category: "arhiva", hostile: true, sha256: "2c3f64b5441b2840abb938ab6f152ba6cfbd170140f589a7e838e93024ac7add", fuzzy: "T107519AE1C47A5A13CE024B324874BE9AF032BAE2D2D3285A4A003204B03DC032327F86" },
  LabeledSample { id: "arhiva-gzip-peste-tar-cu-macro", category: "arhiva", hostile: true, sha256: "6ea690e07248de01a48888a948d92ebfe07841cc4c652affebda092e332a86eb", fuzzy: "T127B02140290304D7C11CC1F406D639258009040D24440485023C0506622249D9A58261" },
  LabeledSample { id: "pdf-benign", category: "pdf", hostile: false, sha256: "87ebcb2c200af0a6233ef8be30dbbaacaae3424c5e16a33acbfac463de2aeea2", fuzzy: "T1DED0E51AFAED0C1CDDA2C95AEE1E39D158421601021C78D0415D6A0A75458A07EC22F3" },
  LabeledSample { id: "pdf-cu-openaction-javascript", category: "pdf", hostile: true, sha256: "3fd7c93176c0345b2bd2bf662b0fd94fff9a6f9ce34f3269d5051d0aeca23102", fuzzy: "T197D02C0AF8EC0C1C9EA2CD0AED2E79D248415101011C7890419DAA1974128E47EC22F3" },
  LabeledSample { id: "pdf-cu-nume-de-actiune-ofuscat", category: "pdf", hostile: true, sha256: "fd51404d796562391baf4ab9533f119ff56348e719d00e9a510d279d0b2d8a1b", fuzzy: "T1ABD0712AF9ED0C2C9DA2C94AEA2E2AA15C525201012C79A0119D6A0975029A4BE836F3" },
  LabeledSample { id: "pdf-cu-launch", category: "pdf", hostile: true, sha256: "59869ac4f5fe437b3b9aa8fb1eef255ef92ae6ebb7d00cd698e73b45fa1dfdc9", fuzzy: "T1E9D02C0AF9DC0C1C8DE2C905EA1F2AE148020101011C3890111C6A0974028B47EC26F3" },
  LabeledSample { id: "pdf-cu-fisier-incorporat", category: "pdf", hostile: true, sha256: "33e9495e1b3a1e49f608c16abb264197e6503d29a06bf64d1b4c5b7c1f424fc5", fuzzy: "T11FD0E51AF9EE0C2CDEA2D94DFE1E39D159561209026C389041AD6A0975028F0BEC3AF3" },
  LabeledSample { id: "executabil-pe-impachetat-upx", category: "executabil", hostile: true, sha256: "3fb0327b876ea60c649899d16f95922ff2829750f39ba1c2714511c89e510208", fuzzy: "T12712EA59C4E16381DB7B41BBCD8F45B22DCCBC39C174E646F392826ADE5A26E0054FAC" },
  LabeledSample { id: "executabil-pe-obisnuit", category: "executabil", hostile: false, sha256: "5907945b140ca4c11e3b3b9e764e802cf951733ac5dd9e99bd578fa1c40172c6", fuzzy: "T190B12015C77845F1C41C037C8A4B65316F6198A057D687025F50E46F3C1A3446CBDE40" },
  LabeledSample { id: "qr-cu-link", category: "qr", hostile: true, sha256: "7829bf01695ebd388129b30a46bc2b78843f11432816f83a951fa50d5ecdcef6", fuzzy: "T161415B1352CCE9F490613DDE50C862F3A27E29ED21CA08F5E8DD59AA55807416DDCEE3" },
  LabeledSample { id: "qr-cu-text-simplu", category: "qr", hostile: true, sha256: "b927e00ef7354949328454e8bb046df0828835f333073b78bc2c81cd2273e594", fuzzy: "T1C631B8405726E8D14616FBA70D36342CED52E84BE0D39F4B28FCC0001A9827A3B87E9B" },
  LabeledSample { id: "imagine-fara-qr", category: "qr", hostile: false, sha256: "f4895cbcb329473b12fbe369d9ea83e4831f86676c09462128b05de32720f88f", fuzzy: "T17BF0AAE1B6EB709BFE2C152999A3F1B6A61001147000EA564BA743351F2A2C5836A7D2" }
];

pub fn lookup_by_digest(digest: &str) -> Option<&'static LabeledSample> {
  let normalized = digest.trim().to_lowercase();
  LABELED_CORPUS.iter().find(|sample| sample.sha256 == normalized)
}

pub fn hostile_sample_count() -> usize {
  LABELED_CORPUS.iter().filter(|sample| sample.hostile).count()
}

pub fn categories() -> Vec<&'static str> {
  let mut out: Vec<&'static str> = Vec::new();
  for sample in LABELED_CORPUS {
    if !out.contains(&sample.category) {
      out.push(sample.category);
    }
  }
  out
}

pub fn digest_of(bytes: &[u8]) -> String {
  use sha2::{Digest, Sha256};
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn known_sample_indicators(bytes: &[u8]) -> Vec<String> {
  let Some(sample) = lookup_by_digest(&digest_of(bytes)) else {
    return similar_sample_indicators(bytes);
  };
  let eticheta = if sample.hostile { "ostila" } else { "beningna" };
  vec![format!(
    "identic cu mostra {eticheta} cunoscuta {} din corpusul etichetat (categoria {})",
    sample.id, sample.category
  )]
}

pub fn fuzzy_sample_count() -> usize {
  LABELED_CORPUS.iter().filter(|sample| !sample.fuzzy.is_empty()).count()
}

pub fn nearest_fuzzy_sample(digest: &str) -> Option<(&'static LabeledSample, i32)> {
  if digest.is_empty() {
    return None;
  }
  LABELED_CORPUS
    .iter()
    .filter(|sample| !sample.fuzzy.is_empty())
    .filter_map(|sample| crate::similarity_hash::fuzzy_distance(digest, sample.fuzzy).map(|distance| (sample, distance)))
    .min_by_key(|(_, distance)| *distance)
}

pub fn similar_sample_indicators(bytes: &[u8]) -> Vec<String> {
  let limits = crate::similarity_hash::FuzzyMatchLimits::default();
  let Some(digest) = crate::similarity_hash::fuzzy_digest(bytes, &limits) else {
    return Vec::new();
  };
  let Some((sample, distance)) = nearest_fuzzy_sample(&digest) else {
    return Vec::new();
  };
  let Some(proximitate) = crate::similarity_hash::classify_distance(distance, &limits) else {
    return Vec::new();
  };
  let eticheta = if sample.hostile { "ostila" } else { "beningna" };
  let cat_de_aproape = match proximitate {
    crate::similarity_hash::Proximity::Near => "foarte apropiat de",
    crate::similarity_hash::Proximity::Related => "inrudit cu",
  };
  vec![format!(
    "continut {cat_de_aproape} mostra {eticheta} cunoscuta {} din corpusul etichetat (categoria {}, distanta {distance})",
    sample.id, sample.category
  )]
}
