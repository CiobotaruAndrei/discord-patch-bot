#![cfg(target_os = "linux")]

use native_inspector::sandbox::{engage_sandbox, SandboxOutcome};
use std::env;
use std::os::unix::process::ExitStatusExt;
use std::process::{exit, Command};

const PROBE_ENV: &str = "DPB_SANDBOX_PROBE";
const EXIT_SURVIVED: i32 = 42;
const EXIT_NOT_ENGAGED: i32 = 43;
const SIGSYS: i32 = 31;

fn run_probe(kind: &str) -> ! {
  match engage_sandbox() {
    SandboxOutcome::Engaged => {}
    _ => exit(EXIT_NOT_ENGAGED),
  }
  match kind {
    "socket" => unsafe {
      libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0);
    },
    "fork" => unsafe {
      libc::fork();
    },
    "allowed" => unsafe {
      let mut spec = libc::timespec { tv_sec: 0, tv_nsec: 0 };
      libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut spec);
    },
    _ => {}
  }
  exit(EXIT_SURVIVED);
}

fn probe(kind: &str) -> std::process::ExitStatus {
  let exe = env::current_exe().expect("binarul de test isi cunoaste calea");
  Command::new(exe)
    .args(["--exact", "--nocapture", "the_filter_is_verified_by_running_probes_in_a_child_process"])
    .env(PROBE_ENV, kind)
    .output()
    .expect("sonda porneste")
    .status
}

#[test]
fn the_filter_is_verified_by_running_probes_in_a_child_process() {
  if let Ok(kind) = env::var(PROBE_ENV) {
    run_probe(&kind);
  }

  let denied_socket = probe("socket");
  assert_eq!(
    denied_socket.signal(),
    Some(SIGSYS),
    "un apel socket() dupa activarea filtrului trebuie sa omoare procesul cu SIGSYS, nu sa fie ignorat"
  );
  assert_ne!(denied_socket.code(), Some(EXIT_SURVIVED), "procesul nu are voie sa supravietuiasca unui syscall interzis");
  assert_ne!(denied_socket.code(), Some(EXIT_NOT_ENGAGED), "filtrul trebuie sa se fi activat inainte de sonda");

  let denied_fork = probe("fork");
  assert_eq!(
    denied_fork.signal(),
    Some(SIGSYS),
    "crearea unui proces nou este interzisa la fel de strict ca reteaua"
  );

  let allowed = probe("allowed");
  assert_eq!(
    allowed.code(),
    Some(EXIT_SURVIVED),
    "un syscall din allowlist trebuie sa treaca; altfel filtrul ar ucide procesul inainte sa raspunda"
  );
  assert_eq!(allowed.signal(), None, "apelul permis nu produce niciun semnal");
}
