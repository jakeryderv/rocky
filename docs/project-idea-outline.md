# Rocky research and evolution outline

Rocky is an agent/agent harness built on Pi packages, initially using
`@earendil-works/pi-coding-agent` as the stock runtime boundary rather than selecting lower-level pieces prematurely.

## Staged experimental idea

Once the software-engineering lifecycle, stable Rocky behavior, and measurable success criteria exist, Rocky could
run multiple isolated Rocky subagents on the same task and retain structured implementation/outcome data. That can
support continuous comparison of settings and features using:

- combinatorial interaction testing;
- feature interaction testing;
- factorial design; and
- ablation studies.

Experiments must use isolated workspaces, pinned prompts/runtime versions, declared factors, repeatable scoring, and
explicit data-retention/security rules. They must not become credentialed or nondeterministic required CI checks.
Start with small controlled studies only after baseline behavior is stable; otherwise measurements would confound
harness churn with the feature being evaluated.

## Specialized subharness idea

Keep the simple Pi-like core, then consider task/workflow-specific subharnesses only when measurements show a real
need. Prefer composable extensions or supported runtime composition over divergent TUI/runtime forks. Any durable
subharness contract, evaluation data format, or trust-boundary change requires an ADR.
