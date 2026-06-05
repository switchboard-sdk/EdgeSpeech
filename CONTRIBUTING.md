# Contributing

## Tests

Run unit tests with:

```bash
npm test
```

## Release

Releases are published to npm automatically when a version tag is pushed. Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH` — increment `MAJOR` for breaking changes, `MINOR` for new features, `PATCH` for bug fixes.

1. Bump the version in `package.json`.
2. Commit: `git commit -am "chore: release vX.Y.Z"`
3. Tag and push:

```bash
git tag vX.Y.Z
git push origin main --tags
```

The [release workflow](.github/workflows/release.yml) builds the package and publishes to npm under the `@synervoz` scope using `npm publish --access public`. Requires an `NPM_TOKEN` secret configured in the repository settings.
