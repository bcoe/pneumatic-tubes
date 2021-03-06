# pneumatic-tubes

Migrate from kappa, npm Enterprise Legacy, and npm Orgs, to npm Enterprise SaaS.

## Installation

```
npm i -g pneumatic-tubes
```

## Preparation

- Node.js 8+
- npm 5 - 5.6 (5.7+ are incompatible with npmE)
- run `npm install`
- login to your _target_ registry if needed: `npm --registry=<target-registry-url> login`

## Importing From Kappa

You need to point the import script at the CouchDB instance associated with your kappa proxy. The kappa proxy itself doesn't foward the `_changes` feed, so direct couch access is necessary.

Run:

```bash
pneumatic-tubes couch-import --source-couch-db=[couch-db-url]/_changes --target-registry=[target-registry-url]
```

## Importing From Legacy npm Enterprise

Fetch `Secret used between services` from your npm Enterprise console.

Run:

```bash
pneumatic-tubes couch-import --source-couch-db=[couch-db-url]/_changes --target-registry=[target-registry-url] --shared-fetch-secret=[password-from-console]
```

You may pass a `--scopes=@example` parameter to limit the import to one (or more, if specified multiple times) scopes.

You may also skip specific semver ranges of specific packages by creating a text file and passing its path with `--exceptions=exceptions.txt`. Each line in this file must be the name of a package, followed by a space, followed by a semver range. For example:

```
@myorg/mypackage < 1.0.0
@myorg/packageidontwant *
```

Would cause pneumatic-tubes to skip any version of `@myorg/mypackage` before version `1.0.0` and _all_ versions of `@myorg/packageidontwant`.

## Importing From npm Orgs

### 1. Create an authorization token

To migrate from npm Orgs, you need an authorization token from the public
registry.

1. visit `https://www.npmjs.com`.
2. in the account drop down in the upper right, choose the option "Tokens".
3. click "Create New Token", and copy this somewhere safe for later.

### 2. Create a text file containing the packages you wish to migrate

_Note: you can only publish scoped modules to your private registry._

The text file should look something like this:

```
@babel/runtime
@babel/core
@babel/template
```

### 3. Login to your npm Enterprise Instance

```
npm config set registry https://registry.my-instance.npme.io
npm login
```

### 4. Create matching organization in npm Enterprise

You should create an organization in npm Enterprise that matches the name of
the organization that you wish to migrate from in npm Orgs.

As an example, if you want to migrate from your organization `@babel` on the
public registry, create an organization named `babel` in npm Enterprise.

### 5. Run the migration tool

It's now time to run the migration tool, using the token and text file that
you generated.

_Note: this will migrate all versions of your module._

```
pneumatic-tubes orgs-import --source-token=[redacted] --target-registry=https://registry..npme.io --migrate-file=migrate-file.txt
```

If the option  `--target-token` is provided, upstream documents will be fetched and
the tool will skip publishing duplicate packages.

## Development

If you are making changes to `pneumatic-tubes`, you can test using a local kappa.

Run kappa in the foreground:
```shell
docker-compose up
```

OR

Run kappa in the background:
```shell
docker-compose up -d
```

When backgrounded, you can tail its logs thus (includes 20 lines of context):
```shell
docker logs --follow --tail 20 pneumatictubes_kappa_1
```
