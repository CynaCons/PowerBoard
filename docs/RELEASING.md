# Releasing PowerBoard

PowerBoard ships a GitHub release containing `PowerBoard.html` and two npm
packages: `powerboard` and `powerboard-mcp`. The tag workflow creates the HTML
release only. Publishing either npm package is a separate, manual owner step.

## Prepare a version

Use Node.js 22.12+ (22.x in CI). Start from a clean checkout of the reviewed
release commit and install both dependency sets:

```bash
npm ci
npm ci --prefix mcp
```

Bump the root and MCP versions together, including both lockfiles. For example,
for a `0.1.1` release, run from the repository root:

```bash
npm version 0.1.1 --no-git-tag-version
npm --prefix mcp version 0.1.1 --no-git-tag-version
```

Use the same version for both packages and the `v0.1.1` tag. Review the manifest
and lockfile changes before committing; do not commit `dist/`, `dist-app/`,
`node_modules/` or test output.

**npm publishing prerequisite:** `mcp/package.json` currently depends on
`powerboard` through the development-only `file:..` link. Before publishing the
MCP package, replace that with the matching published registry version and
refresh `mcp/package-lock.json`. Publish the root package first so that version
is available. Rerun MCP tests and commit those manifest/lockfile changes.
Do not publish an MCP package that still depends on a local filesystem path.

## Check the release candidate

Run from the repository root:

```bash
npm run typecheck
npm test
npm test --prefix mcp
npm run build
npm run build:app
npx playwright install chromium
npx playwright test
```

Open `dist-app/PowerBoard.html` offline, add a card, save with Ctrl+S and reopen
the saved copy. Check the opt-in Agent bridge with `powerboard-mcp` if its code
changed. Requirements and automated test references are in
[`SRS_POWERBOARD.md`](SRS_POWERBOARD.md).

## Create the GitHub release

Commit the reviewed version changes, then create and push an intentional tag
matching the package version:

```bash
git tag -a v0.1.1 -m "PowerBoard v0.1.1"
git push origin v0.1.1
```

[The release workflow](../.github/workflows/release.yml) runs on `v*` tag pushes.
It installs the root and MCP dependencies with `npm ci`, runs both test suites,
builds the library and app, then uses `gh release create` with `GITHUB_TOKEN`.
The workflow needs `contents: write` and attaches `dist-app/PowerBoard.html` as
`PowerBoard.html`, with generated release notes.

Check that the workflow succeeded and the release has the HTML attachment.
Download the attachment and confirm it opens offline. The stable download is
[`releases/latest/download/PowerBoard.html`](https://github.com/CynaCons/PowerBoard/releases/latest/download/PowerBoard.html).
If a run fails before publishing, fix the cause before rerunning it. If the
release already exists, inspect it before retrying: `gh release create` does not
overwrite an existing release.

## Publish npm packages manually

Only the owner should perform this step, with their own npm login and publishing
rights for both package names. No npm token is configured in the tag workflow.
Follow npm's authentication and two-factor prompts locally; never commit tokens.

```bash
npm login
npm whoami
npm pack --dry-run
npm publish
```

The root package's `prepare` script builds the library. Inspect the dry-run file
list for the subpath exports, stylesheet, README and license before publishing.

After the root version is available on npm, resolve the MCP local dependency
prerequisite above and rerun its tests. Then publish from `mcp/`:

```bash
cd mcp
npm pack --dry-run
npm publish
cd ..
```

The MCP package's `prepack` script refreshes `mcp-tools.js` from the shared
`mcp-tools/index.js`; check that this generated copy matches the committed one.
Inspect the dry-run file list for `server.js`, `mcp-tools.js` and the MCP README.

Verify both published versions with `npm view powerboard version` and
`npm view powerboard-mcp version`. Test `npx -y powerboard-mcp@0.1.1` in an MCP
client against the downloaded HTML, including a named card write. An npm version
cannot be overwritten: fix a bad package with a new version, bumping both
packages together again.
