# Security policy

## Supported versions

Rocky is pre-release. Only the current `main` branch is supported.

## Reporting

Do not open a public issue for a suspected vulnerability. Contact the repository owner privately through the
security-reporting mechanism on the GitHub repository. Do not include live credentials or sensitive repository
content in a report.

## Threat model and boundaries

Repository content, prompts, model output, tool arguments, imported sessions, and project-local configuration are
untrusted input. Pi project trust controls whether project resources are loaded; it is not a sandbox. Extensions
and packages execute arbitrary code with the Rocky process's permissions. Shell access can escape application-level
path policies. Model requests may send source, prompts, and tool results to external providers. Sessions and logs
may contain sensitive data.

Operational guidance:

- Keep credentials in provider environment variables or Rocky's global `~/.rocky/agent/auth.json`, never in
  project-local `<cwd>/.rocky/`.
- Review project resources and third-party packages before approving trust. Rocky does not automatically load
  shared/ancestor `.agents/skills` or generic AGENTS.md/CLAUDE.md context files.
- Use `--no-approve` in noninteractive automation unless project resources were deliberately approved.
- Prefer `--tools read,grep,find,ls` for read-only work; enabling `bash`, `edit`, or `write` permits mutation.
- Use an OS container, VM, or equivalent isolation boundary for unattended or untrusted work.
- Keep session/log retention bounded. On POSIX, Rocky enforces mode `0700` on agent/session directories and `0600`
  on session files, including custom session directories.
- Install `fd`/`fdfind` and `rg` through the operating system package manager. Rocky refuses executables under
  `~/.rocky/agent/bin/` and does not permit Pi's unpinned managed-tool download path.
- Required CI strips inherited provider, cloud, proxy, and credential-helper variables and never calls a live model
  provider.

Run `npm run security:audit` for the live npm production-dependency advisory check. It is separate from the
deterministic local gate because advisory results require network access and change over time.
