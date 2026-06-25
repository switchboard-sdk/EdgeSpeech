# Contributing

## Tests

Run unit tests with:

```bash
npm test
```

## Release

Releases are published to npm automatically when a version tag is pushed. Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH` — increment `MAJOR` for breaking changes, `MINOR` for new features, `PATCH` for bug fixes.

1. Bump the version with npm:

```bash
npm version patch   # or minor / major
```

2. Push the commit and tag:

```bash
git push && git push --tags
```

The [release workflow](.github/workflows/publish.yml) builds the package and publishes to npm under the `@synervoz` scope.
