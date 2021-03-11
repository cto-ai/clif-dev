# @cto.ai/clif-dev


> 👾 clif developer tool


## Status - WIP


## Engines

* Node 12.4+
* Node 14.0+

## Development

Test:

```sh
npm test
```

Visual coverage report (run after test):

```sh
npm run cov
```

Lint:

```sh
npm run lint
```

Autoformat:

```sh
npm run lint -- --fix
```

## Releasing

For mainline releases:

```sh
npm version <major|minor|patch>
git push --follow-tags
```

For prereleases:

```sh
npm version prerelease
git push --follow-tags
```

### License

MIT
