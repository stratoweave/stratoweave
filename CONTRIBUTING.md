# Contributing to StratoWeave

This guide applies to all repositories in the
[StratoWeave GitHub organization](https://github.com/stratoweave), unless a
repository provides a more specific `CONTRIBUTING.md`, which takes precedence
for that repository. All contributions remain subject to the Project's
[Technical Charter](https://lfx-cdn-prod.s3.us-east-1.amazonaws.com/project-artifacts/stratoweave/stratoweave_Charter.pdf?v=1772574235908)
and applicable LF Projects policies.

We welcome contributions of code, documentation, tests, bug reports, and ideas.
Participation is open to individuals and organizations on equal terms, regardless
of competitive interests.

## Where to start

- **Bug fixes, minor changes, test improvements, and documentation updates:** we
  encourage you to open a [pull request](https://github.com/stratoweave/stratoweave/pulls)
  directly, or reach out through [GitHub issues](https://github.com/stratoweave/stratoweave/issues)
  if you want to report a problem or discuss an approach first.
- **Larger functional changes:** we recommend thoroughly reviewing the [platform
  architecture and design guidelines](docs/reference/index.md)
  and joining a Technical Steering Committee (TSC) 
  [meeting](https://lf-networking.atlassian.net/wiki/spaces/StratoWeave/pages/1005813812)
  to discuss your proposal before substantial implementation work. Open an issue describing
  the problem, proposed design, alternatives, and compatibility implications.

Keep proposals, discussion outcomes, and decisions publicly accessible in issues,
pull requests, or meeting minutes so others can participate.

## Preparing a pull request

1. Keep the change focused and explain the problem, the solution, and any change
   in behavior. Link related issues; for bug reports, include reproduction steps
   and expected and actual results.
2. Follow the surrounding code and documentation conventions. Add or update tests
   and documentation where relevant.
3. For code changes, run `make build` and `make test` from the repository root,
   along with any checks relevant to the affected component. Describe what you
   tested and any checks you could not run in the pull request.
4. Include the licensing information and code sign-offs described below, and
   respond to review feedback. Maintainers review and merge contributions; the
   TSC oversees technical direction and project contribution policies.

## Licensing and sign-off

- New code contributions must be submitted under the
  [BSD-3-Clause license](LICENSES/BSD-3-Clause.txt).
- Documentation contributions are received and distributed under the
  [Creative Commons Zero v1.0 Universal license](LICENSES/CC-1.0.txt).
- Contributed files should carry accurate copyright and license information,
  including SPDX identifiers. Preserve applicable third-party notices and comply
  with upstream and dependency licenses.

Every new code contribution must include a
[Developer Certificate of Origin (DCO) 1.1](https://developercertificate.org/)
sign-off in its commits. Read the DCO and sign off only when you can make its
certifications and are authorized to submit the contribution under the applicable
license. Use:

```sh
git commit -s
```

This adds a trailer using your configured name and email address:

```text
Signed-off-by: Your Name <you@example.com>
```

An alternative license requires an exception approved by a two-thirds vote of the
entire TSC. Request an exception by describing the contribution, proposed license,
and justification in a GitHub issue. Existing file metadata alone does not
establish a charter exception.

## Governance and community conduct

All participants must comply with the [Technical Charter](https://lfx-cdn-prod.s3.us-east-1.amazonaws.com/project-artifacts/stratoweave/stratoweave_Charter.pdf?v=1772574235908) and the
[LF Projects policies](https://lfprojects.org/policies/), including the
[LF Projects Code of Conduct](https://lfprojects.org/policies/code-of-conduct/)
and the [Antitrust Policy](https://lfprojects.org/policies/antitrust-policy/).
Work professionally, respect others and their intellectual property,
and keep participation open and nondiscriminatory.

### TSC voting members

The TSC is responsible for the Project's technical oversight under the charter.
To fulfill that responsibility, StratoWeave TSC members are expected to be
software architects or developers with a deep understanding of the platform
architecture and a demonstrated track record of contributions to the Project.

| Member | Affiliation |
| --- | --- |
| Ian Farrer | Deutsche Telekom |
| Kristian Larsson | Centor |
| Kris Lambrechts | Intwine |
| Johan Nordlander | Compilaris |
| Marko Zagožen | Flint SI |

### Maintainers

| GitHub profile | Name |
| --- | --- |
| [ahuangfeng](https://github.com/ahuangfeng) | Alex Huang Feng |
| [bdolenc](https://github.com/bdolenc) | Blaž Dolenc |
| [calvincheng8](https://github.com/calvincheng8) | Calvin Cheng |
| [iffy50](https://github.com/iffy50) | Ian Farrer |
| [plajjan](https://github.com/plajjan) | Kristian Larsson |
| [klambrec](https://github.com/klambrec) | Kris Lambrechts |
| [mzagozen](https://github.com/mzagozen)| Marko Zagožen |
| [nordlander](https://github.com/nordlander) | Johan Nordlander |
| [sydow](https://github.com/sydow) | |
