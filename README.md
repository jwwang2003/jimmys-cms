# jimmys-cms

- Built using the NextJS Framework
    > This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
- Mantine UI
- Amazon AWS
    - S3 Buckets (for storing static content)
- Hosted on DigitalOcean
- Testing framework(s):
    - Jtest
- Other:
    - [Better Auth]() provides authentication
    - Uses [Drizzle ORM]() for managing the SQL side of things
    - And maybe other things

## Getting Started

Set up your local AWS environment:
```bash
aws configure
```

### Development

```bash
# Dev server
pnpm dev

# Test
pnpm test
pnpm test:dev
pnpm test:prod
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---

#### SQL Schema

**[Drizzle ORM](https://orm.drizzle.team/)** is used for the storage backend

- Make sure Drizzle Kit is installed: `pnpm add -D drizzle-kit`

The following commands are available:
```
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
pnpm drizzle-kit push
pnpm drizzle-kit pull
pnpm drizzle-kit check
pnpm drizzle-kit up
pnpm drizzle-kit studio
```

---

#### Auth

**[Better Auth](https://www.better-auth.com/)** is used for implementing the authentication backend (it works with Drizzle ORM).

In the project root, run `npx @better-auth/cli@latest generate` to generate a auth schema called `auth-schema.ts`.

Make sure that this schema file is included in the `drizzle.config.ts`.

---

### Production

```bash
pnpm start

pnpm build
```

## Amazon AWS

So far the only AWS service used are the S3 buckets.

- Ensure that AWS CLI is installed a login via SSO \(Access key & Secret access key\). Refer to the following links:
    - [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
    - [Logging in via the CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)

## Media Library Schema

All CMS media metadata is modeled with Drizzle (see `src/db/schema/schema.ts`). The binary objects live in S3, while SQLite only
tracks metadata and relationships:

- `storage_locations` keeps the known bucket aliases, regions, and CDN base URLs.
- `media_assets` represents every uploaded file (images, videos, docs, etc.) along with S3 keys, MIME type, dimensions, duration,
  visibility, and publication status.
- `media_renditions` stores optional derived variants (thumbnails, bitrate versions).
- `storage_folders` defines canonical prefixes for images, videos, GIFs, and misc content per bucket; `storage_objects` snapshots
  each raw S3 object (key, size, folder, checksum) so you can audit bucket contents.
- `tags` and `media_tags` provide a reusable tagging vocabulary with many-to-many links.
- `media_attributes` captures arbitrary key/value metadata (namespaced) for future frontends to query without schema churn.
- `collections` and `collection_assets` let you curate playlists/boards tied to assets.

These tables are intentionally metadata-only. Each row references the S3 object via `storage_id` + `object_key`, so multiple
frontends can render content while S3 holds the raw binaries.

# References
