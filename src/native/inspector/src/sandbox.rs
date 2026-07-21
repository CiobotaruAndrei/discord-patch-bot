pub enum SandboxOutcome {
  Engaged,
  Unsupported(String),
  Failed(String),
}

pub const ALLOWED_SYSCALLS: &[&str] = &[
  "read",
  "write",
  "readv",
  "writev",
  "close",
  "fstat",
  "lseek",
  "mmap",
  "munmap",
  "mremap",
  "mprotect",
  "brk",
  "futex",
  "clock_gettime",
  "clock_nanosleep",
  "nanosleep",
  "gettimeofday",
  "getrandom",
  "sched_yield",
  "sched_getaffinity",
  "madvise",
  "poll",
  "ppoll",
  "epoll_wait",
  "epoll_pwait",
  "restart_syscall",
  "rt_sigreturn",
  "rt_sigaction",
  "rt_sigprocmask",
  "sigaltstack",
  "exit",
  "exit_group",
];

pub const DENIED_SYSCALLS: &[&str] = &[
  "execve",
  "execveat",
  "fork",
  "vfork",
  "clone",
  "ptrace",
  "mount",
  "umount2",
  "unshare",
  "setns",
  "chroot",
  "pivot_root",
  "socket",
  "socketpair",
  "connect",
  "bind",
  "listen",
  "accept",
  "accept4",
  "sendto",
  "recvfrom",
  "open",
  "openat",
  "creat",
  "unlink",
  "unlinkat",
  "rename",
  "renameat",
  "mkdir",
  "init_module",
  "finit_module",
  "delete_module",
  "reboot",
  "kexec_load",
  "bpf",
  "perf_event_open",
];

#[cfg(target_os = "linux")]
mod engine {
  use super::*;
  use libseccomp::{ScmpAction, ScmpFilterContext, ScmpSyscall};

  pub fn engage() -> SandboxOutcome {
    let mut filter = match ScmpFilterContext::new(ScmpAction::KillProcess) {
      Ok(filter) => filter,
      Err(error) => return SandboxOutcome::Failed(format!("filtrul seccomp nu a putut fi creat: {error}")),
    };
    if let Err(error) = filter.set_ctl_nnp(true) {
      return SandboxOutcome::Failed(format!("no-new-privs nu a putut fi setat: {error}"));
    }
    for name in ALLOWED_SYSCALLS {
      let syscall = match ScmpSyscall::from_name(name) {
        Ok(syscall) => syscall,
        Err(_) => continue,
      };
      if let Err(error) = filter.add_rule(ScmpAction::Allow, syscall) {
        return SandboxOutcome::Failed(format!("regula pentru {name} nu a putut fi adaugata: {error}"));
      }
    }
    match filter.load() {
      Ok(()) => SandboxOutcome::Engaged,
      Err(error) => SandboxOutcome::Failed(format!("filtrul seccomp nu a putut fi incarcat: {error}")),
    }
  }
}

#[cfg(not(target_os = "linux"))]
mod engine {
  use super::*;

  pub fn engage() -> SandboxOutcome {
    SandboxOutcome::Unsupported(
      "seccomp exista doar pe Linux; pe acest sistem procesul ruleaza fara filtru de syscall".to_string(),
    )
  }
}

pub fn engage_sandbox() -> SandboxOutcome {
  engine::engage()
}

pub fn describe(outcome: &SandboxOutcome) -> String {
  match outcome {
    SandboxOutcome::Engaged => "filtru de syscall activ (seccomp, ireversibil)".to_string(),
    SandboxOutcome::Unsupported(detail) => format!("fara filtru de syscall: {detail}"),
    SandboxOutcome::Failed(detail) => format!("filtrul de syscall a esuat: {detail}"),
  }
}

pub fn sandbox_supported() -> bool {
  cfg!(target_os = "linux")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn allowlist_si_denylist_nu_se_suprapun() {
    for denied in DENIED_SYSCALLS {
      assert!(
        !ALLOWED_SYSCALLS.contains(denied),
        "{denied} nu poate fi si permis si interzis - politica ar fi ambigua"
      );
    }
  }

  #[test]
  fn apelurile_care_deschid_resurse_noi_nu_sunt_in_allowlist() {
    for critical in ["execve", "ptrace", "socket", "connect", "openat", "mount", "unshare", "bpf"] {
      assert!(
        !ALLOWED_SYSCALLS.contains(&critical),
        "{critical} ar deschide o resursa noua din procesul care parseaza fisiere netrusted"
      );
    }
  }

  #[test]
  fn allowlist_acopera_ce_are_nevoie_un_proces_care_doar_citeste_si_scrie_pe_stdio() {
    for required in ["read", "write", "mmap", "munmap", "futex", "exit_group", "rt_sigreturn"] {
      assert!(
        ALLOWED_SYSCALLS.contains(&required),
        "{required} lipseste din allowlist, deci procesul ar fi ucis inainte sa raspunda"
      );
    }
  }

  #[test]
  fn fiecare_stare_a_sandbox_ului_are_o_descriere_proprie_pentru_log() {
    let engaged = describe(&SandboxOutcome::Engaged);
    let unsupported = describe(&SandboxOutcome::Unsupported("platforma X".to_string()));
    let failed = describe(&SandboxOutcome::Failed("kernel fara suport".to_string()));

    assert!(engaged.contains("activ"));
    assert!(unsupported.contains("platforma X"), "motivul exact ajunge in log, nu doar faptul ca lipseste");
    assert!(failed.contains("kernel fara suport"));
    assert_ne!(engaged, unsupported);
    assert_ne!(unsupported, failed);
  }

  #[test]
  fn suportul_este_raportat_dupa_platforma_nu_presupus() {
    assert_eq!(sandbox_supported(), cfg!(target_os = "linux"));
  }
}
