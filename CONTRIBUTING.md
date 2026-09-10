# Contributing to Open Historia

Thanks for helping build Open Historia. This page covers the one legal step every contributor takes once, and the practical shape of a good pull request.

## The Contributor License Agreement

Open Historia accepts contributions only under its [Contributor License Agreement](CLA.md). In short:

- You keep the copyright in your contributions and grant the Open Historia Organisation and its members an exclusive, irrevocable licence to use, change and relicense them in any way, so the Project can be licensed, relicensed and defended as one whole.
- You keep the right to use your own contributions for your own purposes and to share them under the Project's public licence. Because the licence is exclusive, you may not license them to others on other terms.
- You confirm the work is yours to give, and you tell us about any third-party material in it.
- Open Historia publishes what it accepts under the Project's public licence (currently AGPL-3.0-or-later), and may license it under other terms as well.

Read the full text before you sign; the summary above does not replace it.

### How signing works

Signing is electronic and takes a minute:

1. Open a pull request against any Open-Historia repository.
2. The CLA Assistant bot comments on the pull request with a link, and the pull request's CLA status check stays pending until you sign. You can also go straight to [cla-assistant.io/Open-Historia/open-historia](https://cla-assistant.io/Open-Historia/open-historia).
3. Sign in with GitHub, fill in your name and e-mail address, and confirm that you agree.

You sign once, for the whole Project, and it covers pull requests you have already opened; the status check updates on its own once you have signed.

If you contribute for an employer or another organization, that organization signs the Agreement itself (choose "On behalf of a legal entity" when signing, and make sure you are authorized to sign for it) and names its contributors. If you are unsure whether your employer holds rights in what you write, ask them before you open the pull request.

The text at [CLA.md](CLA.md) is the canonical copy. The [Gist that CLA Assistant shows you](https://gist.github.com/Arkniem/f872c1b70ee0e762d87f927c199e6c9d) mirrors it; if the two ever differ, the version you signed governs your contributions.

## Pull requests

- Keep one change per pull request, with a title that says what changed and a body that says why.
- Say where anything in the change came from if it is not your own work: a library, a dataset, a map, an image, a translation, or code produced with substantial help from an AI tool. Name the source and its licence.
- Do not add third-party material under a licence that would apply to the whole Project. Anything under a copyleft licence other than the Project's own needs a discussion first.
- Run `npm test` and `npx eslint .` before you push. A pull request that changes what the app does should say how you checked it.
- Target `main` unless a maintainer has pointed you at another branch.

## Reporting problems

Bugs and feature requests go to the [issue tracker](https://github.com/Open-Historia/open-historia/issues). For anything sensitive, such as a security problem, use the contact details on the [Open-Historia organization page](https://github.com/Open-Historia) rather than a public issue.
