# Release checklist

1. `main` is green and `npm test` passes locally.
2. Optional dry run: Actions → **Build installers** → Run workflow. Install the
   artifacts on a real machine and walk through [TESTING.md](TESTING.md).
3. Bump `version` in `package.json` (e.g. `0.2.0`), commit, merge to `main`.
4. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
5. The **Release** workflow builds the dmg, exe, AppImage and deb and attaches
   them to a GitHub Release (with generated notes).
6. Check the Release page has all four files, then download one and open it.
7. Check `https://wehatemail.com/join` download buttons point at the release
   (they link to GitHub Releases).
8. Installers are unsigned: say so in the release notes (macOS: right-click →
   Open; Windows: More info → Run anyway).

If a build fails, fix it, delete the tag (`git push --delete origin v0.2.0`,
`git tag -d v0.2.0`) and tag again.
