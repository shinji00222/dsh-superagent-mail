# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

## This fork: Persona-aware task routing

This repository is a fork of
[`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype),
starting from its `8c32a9d` commit. Upstream work is unchanged; the fork adds one feature on top.

**What it adds.** Before a Ticket's first Assignment starts, the Super-agent chooses a Persona
(research, plan, implement, test, review), persists it on the Ticket together with the exact text it
injected and why, and never re-decides: retries, reopens, host restarts and prompt-template updates
reuse the first binding. The Persona contributes only work strategy and output requirements; the
Mandate, tool permissions, Ticket goal, workspace and Session history stay as they are.

**Where to look.**

- [docs/009 Persona routing](docs/009-persona-routing.md): the design, the optional interface, the
  audit record, the known limitations.
- [docs/010 Verification](docs/010-verification.md): the commands that were run, the acceptance
  matrix, the isolated-profile evidence, and what was deliberately not executed.
- [`packages/persona-router`](packages/persona-router/README.md): the independent routing Bundle
  (catalog, rules, operator overrides, `off|fixed|random|rules` modes, installable tarball).
- [`experiments`](experiments/README.md): fixed tasks, checkers, blind rubric and arm definitions.
  The A–D benefit experiment was **not executed**; no result is claimed.
- [CHANGELOG.md](CHANGELOG.md): version history; `v0.2.0` is this feature.

**License and credit.** Upstream code is MIT-licensed (see [LICENSE](LICENSE)); this fork keeps that
license and the upstream authorship notice. The Persona routing additions are licensed the same way.
When reusing this work, keep the upstream link and commit above.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source
- [009 Persona routing](docs/009-persona-routing.md): binding a Persona to a Ticket before its first Assignment, and the optional routing Bundle
- [010 Verification](docs/010-verification.md): what was executed, the acceptance matrix, and the known gaps

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
