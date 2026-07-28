pub const LABELED_CORPUS_VERSION: u32 = 1;

pub struct LabeledSample {
  pub id: &'static str,
  pub category: &'static str,
  pub hostile: bool,
  pub sha256: &'static str
}

pub const LABELED_CORPUS: &[LabeledSample] = &[
  LabeledSample { id: "arhiva-zip-benigna", category: "arhiva", hostile: false, sha256: "2848dc7f83ecb9d76b68e339937b414e28052c9a3f6e39d12cae3715593197c6" },
  LabeledSample { id: "arhiva-zip-cu-executabil", category: "arhiva", hostile: true, sha256: "649b658906fc333a9d7c7cc784b07205992ba6378c471734656c9a7d7d14858b" },
  LabeledSample { id: "arhiva-zip-imbricata-cu-executabil", category: "arhiva", hostile: true, sha256: "f5634337366c804944477bedc47bc69b50271f275579e59140654c92e3ce931a" },
  LabeledSample { id: "arhiva-zip-criptata", category: "arhiva", hostile: true, sha256: "d1756607423b47599e367135135a02eb5d9d4bfd3e655fd3846415c8508b64c0" },
  LabeledSample { id: "arhiva-zip-bomba-de-compresie", category: "arhiva", hostile: true, sha256: "5b60a0fa1ffed520736f10f29d2cb23129e533d78ac9717fc14794a605d4fa4e" },
  LabeledSample { id: "arhiva-tar-office-cu-macro", category: "arhiva", hostile: true, sha256: "2c3f64b5441b2840abb938ab6f152ba6cfbd170140f589a7e838e93024ac7add" },
  LabeledSample { id: "arhiva-gzip-peste-tar-cu-macro", category: "arhiva", hostile: true, sha256: "6ea690e07248de01a48888a948d92ebfe07841cc4c652affebda092e332a86eb" },
  LabeledSample { id: "pdf-benign", category: "pdf", hostile: false, sha256: "87ebcb2c200af0a6233ef8be30dbbaacaae3424c5e16a33acbfac463de2aeea2" },
  LabeledSample { id: "pdf-cu-openaction-javascript", category: "pdf", hostile: true, sha256: "3fd7c93176c0345b2bd2bf662b0fd94fff9a6f9ce34f3269d5051d0aeca23102" },
  LabeledSample { id: "pdf-cu-nume-de-actiune-ofuscat", category: "pdf", hostile: true, sha256: "fd51404d796562391baf4ab9533f119ff56348e719d00e9a510d279d0b2d8a1b" },
  LabeledSample { id: "pdf-cu-launch", category: "pdf", hostile: true, sha256: "59869ac4f5fe437b3b9aa8fb1eef255ef92ae6ebb7d00cd698e73b45fa1dfdc9" },
  LabeledSample { id: "pdf-cu-fisier-incorporat", category: "pdf", hostile: true, sha256: "33e9495e1b3a1e49f608c16abb264197e6503d29a06bf64d1b4c5b7c1f424fc5" },
  LabeledSample { id: "executabil-pe-impachetat-upx", category: "executabil", hostile: true, sha256: "3fb0327b876ea60c649899d16f95922ff2829750f39ba1c2714511c89e510208" },
  LabeledSample { id: "executabil-pe-obisnuit", category: "executabil", hostile: false, sha256: "5907945b140ca4c11e3b3b9e764e802cf951733ac5dd9e99bd578fa1c40172c6" },
  LabeledSample { id: "qr-cu-link", category: "qr", hostile: true, sha256: "7829bf01695ebd388129b30a46bc2b78843f11432816f83a951fa50d5ecdcef6" },
  LabeledSample { id: "qr-cu-text-simplu", category: "qr", hostile: true, sha256: "b927e00ef7354949328454e8bb046df0828835f333073b78bc2c81cd2273e594" },
  LabeledSample { id: "imagine-fara-qr", category: "qr", hostile: false, sha256: "f4895cbcb329473b12fbe369d9ea83e4831f86676c09462128b05de32720f88f" }
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
    return Vec::new();
  };
  let eticheta = if sample.hostile { "ostila" } else { "beningna" };
  vec![format!(
    "identic cu mostra {eticheta} cunoscuta {} din corpusul etichetat (categoria {})",
    sample.id, sample.category
  )]
}
