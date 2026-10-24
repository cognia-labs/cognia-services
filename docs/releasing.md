# Releasing

Services ship on their own schedule. There are three kinds of output, and a
version tag only drives the first.

| Output                     | How it ships                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container images           | `images.yml`: `edge` + `sha-<commit>` on every push to `main`; `X.Y.Z`, `X.Y` and `latest` on a `vX.Y.Z` tag                                                           |
| Cloudflare Workers, Fly.io | `deploy.yml`, run by hand per environment and target (see [Deploying](../README.md#deploying)); update and Logto mail Workers by hand with `pnpm exec wrangler deploy` |
| Contracts for the app      | no release: the app pins a commit (see [contracts](contracts.md))                                                                                                      |

Images published: `ghcr.io/cognia-labs/cognia-signaling`, `cognia-share` and
`cognia-diagnostics`. The app's self-host compose files pull `latest` by default,
so `latest` must always be a tested tag.

## Cutting a version

1. Make sure every workflow on the `main` commit you are tagging is green.
2. Move the entries under `## Unreleased` in [`CHANGELOG.md`](../CHANGELOG.md) to a
   new `## X.Y.Z — YYYY-MM-DD` section and merge that change.
3. Tag the merge commit with an annotated tag under your GitHub identity and
   push it:

   ```bash
   git -c tag.gpgSign=false tag -a vX.Y.Z -m "cognia-services vX.Y.Z"
   git push origin vX.Y.Z
   ```

   `git cat-file -p vX.Y.Z` should show your GitHub name and email as the
   tagger. Sign the tag (`git tag -s`) only with a GPG or SSH key that is
   uploaded to that GitHub account; a global `user.signingkey` from another
   identity puts the wrong name on the release and shows as unverified.

4. Watch `images.yml` for the tag. Then check that each package under the
   organisation's **Packages** tab is public, so compose users can pull it
   without logging in.
5. Optionally create a GitHub release from the tag with the changelog section.

Versioning follows SemVer for the images: a major bump when a service drops a
wire form or a configuration variable, a minor bump for new behaviour, a patch
bump for fixes.

## Rolling back

- Images: point compose at the previous version tag (`SIGNALING_IMAGE`,
  `SHARE_IMAGE` in the app's compose `.env`), or re-tag `latest` by pushing a
  new patch tag from the earlier commit.
- Workers: `pnpm exec wrangler rollback` in the Worker's directory, or rerun
  `deploy.yml` from the earlier commit. D1 migrations are not rolled back with the
  code: an older Worker must still work against the migrated schema, so read the
  service README's migration notes before rolling back past one.
