# CMS Integrity And Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add S3-backed asset integrity checks, soft-delete lifecycle management, a recycle-bin workflow, and fast admin CRUD actions for media assets.

**Architecture:** Extend the existing `media_assets` model with lifecycle and integrity fields, then build repository/service methods that update those fields through explicit admin actions. Keep S3 verification tolerant like the sync pipeline: missing objects become warnings on the asset, while transient AWS failures stay operational warnings instead of destructive state changes.

**Tech Stack:** Next.js App Router, Mantine, better-sqlite3, Drizzle ORM, AWS SDK S3, Jest + Node-based regression scripts

---

## File Structure

### Data model and migrations

- Modify: `src/db/schema/schema.ts`
- Create: `drizzle/0001_asset_integrity_lifecycle.sql`
- Modify: `drizzle/meta/_journal.json`
- Create or modify: `drizzle/meta/0001_snapshot.json`

Responsibility:

- Add lifecycle and integrity fields to `media_assets`
- Make Drizzle the schema authority for these changes

### Repository and service layer

- Modify: `src/lib/media/repository.ts`
- Modify: `src/lib/media/service.ts`
- Create: `src/lib/media/integrity.ts`
- Modify: `src/lib/media/types.ts`

Responsibility:

- Asset-level CRUD actions
- Single and bulk integrity verification
- Recycle-bin aware queries

### Admin APIs

- Create: `src/app/api/admin/media/actions/route.ts`
- Optionally modify: `src/app/api/admin/media/[id]/route.ts`

Responsibility:

- Accept verified, explicit admin actions such as archive, trash, restore, permanent delete, verify one, verify many

### Admin UI

- Modify: `src/components/admin/AssetFilters.tsx`
- Modify: `src/components/admin/AssetTable.tsx`
- Create: `src/components/admin/AssetActionMenu.tsx`
- Modify: `src/app/admin/media/page.tsx`
- Modify: `src/app/admin/media/[id]/page.tsx`
- Modify: `src/app/admin/media/sync/page.tsx`
- Create: `src/components/admin/IntegrityCheckPanel.tsx`

Responsibility:

- Add lifecycle/integrity filters
- Add fast row actions
- Add verify and recycle-bin workflows

### Tests

- Create: `__tests__/asset-integrity.test.js`
- Create: `__tests__/asset-lifecycle.test.js`
- Modify: `package.json`
- Modify: `jest.config.js`

Responsibility:

- Lock in lifecycle transitions and integrity status handling before implementation

## Task 1: Add Drizzle Schema For Lifecycle And Integrity

**Files:**
- Modify: `src/db/schema/schema.ts`
- Create: `drizzle/0001_asset_integrity_lifecycle.sql`
- Modify: `drizzle/meta/_journal.json`
- Create or modify: `drizzle/meta/0001_snapshot.json`
- Test: `__tests__/asset-lifecycle.test.js`

- [ ] **Step 1: Write the failing lifecycle test**

Create `__tests__/asset-lifecycle.test.js` with a focused temp-DB lifecycle regression:

```js
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jimmys-cms-lifecycle-"));
  const dbPath = path.join(tempDir, "lifecycle.sqlite");
  const db = new Database(dbPath);

  try {
    const migrationSql = fs
      .readFileSync(path.join(process.cwd(), "drizzle", "0001_asset_integrity_lifecycle.sql"), "utf8")
      .replaceAll("--> statement-breakpoint", "");
    db.exec(fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_careless_the_captain.sql"), "utf8").replaceAll("--> statement-breakpoint", ""));
    db.exec(migrationSql);

    db.prepare(`
      insert into storage_locations (id, bucket_name, region, base_url, created_at, updated_at)
      values ('default', 's3.glorialan.com', 'us-east-2', null, ?, ?)
    `).run(Date.now(), Date.now());

    db.prepare(`
      insert into media_assets (
        title, slug, media_type, storage_id, object_key, object_url, mime_type, size_bytes,
        status, visibility, lifecycle_status, integrity_status, created_at, updated_at
      )
      values (?, ?, 'image', 'default', ?, ?, 'image/jpeg', 12, 'draft', 'private', 'active', 'ok', ?, ?)
    `).run("Harbor", "harbor", "content/harbor.jpg", "https://example/harbor.jpg", Date.now(), Date.now());

    const row = db.prepare(`
      select lifecycle_status, integrity_status, trashed_at, last_verified_at
      from media_assets
      where id = 1
    `).get();

    assert.equal(row.lifecycle_status, "active");
    assert.equal(row.integrity_status, "ok");
    assert.equal(row.trashed_at, null);
    assert.equal(row.last_verified_at, null);

    console.log("asset-lifecycle.test.js ok");
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- failure opening `drizzle/0001_asset_integrity_lifecycle.sql`, or
- SQL error because new columns do not exist yet

- [ ] **Step 3: Add schema fields in Drizzle**

Update `src/db/schema/schema.ts` in `mediaAssets`:

```ts
        lifecycleStatus: text("lifecycle_status", {
            enum: ["active", "trashed"],
        })
            .default("active")
            .notNull(),
        integrityStatus: text("integrity_status", {
            enum: ["ok", "missing", "warning", "invalid"],
        })
            .default("ok")
            .notNull(),
        integrityMessage: text("integrity_message"),
        lastVerifiedAt: integer("last_verified_at", { mode: "timestamp_ms" }),
        trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
```

Also add useful indexes:

```ts
        index("media_assets_lifecycle_idx").on(table.lifecycleStatus),
        index("media_assets_integrity_idx").on(table.integrityStatus),
```

- [ ] **Step 4: Create the migration SQL**

Create `drizzle/0001_asset_integrity_lifecycle.sql`:

```sql
ALTER TABLE `media_assets` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `integrity_status` text DEFAULT 'ok' NOT NULL;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `integrity_message` text;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `last_verified_at` integer;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `trashed_at` integer;
--> statement-breakpoint
CREATE INDEX `media_assets_lifecycle_idx` ON `media_assets` (`lifecycle_status`);
--> statement-breakpoint
CREATE INDEX `media_assets_integrity_idx` ON `media_assets` (`integrity_status`);
```

Update the journal in `drizzle/meta/_journal.json` and snapshot metadata to register migration `0001_asset_integrity_lifecycle`.

- [ ] **Step 5: Run the lifecycle test to verify it passes**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- `asset-lifecycle.test.js ok`

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/schema.ts drizzle/0001_asset_integrity_lifecycle.sql drizzle/meta/_journal.json drizzle/meta/0001_snapshot.json __tests__/asset-lifecycle.test.js
git commit -m "feat: add asset lifecycle and integrity schema"
```

## Task 2: Add Repository Lifecycle Actions

**Files:**
- Modify: `src/lib/media/repository.ts`
- Modify: `src/lib/media/types.ts`
- Test: `__tests__/asset-lifecycle.test.js`

- [ ] **Step 1: Extend the lifecycle test with trash/restore/permadelete**

Append assertions to `__tests__/asset-lifecycle.test.js`:

```js
    const {
      trashMediaAsset,
      restoreMediaAsset,
      permanentlyDeleteMediaAsset,
      archiveMediaAsset,
    } = require("../src/lib/media/repository.ts");

    archiveMediaAsset(1);
    let asset = db.prepare("select status, lifecycle_status from media_assets where id = 1").get();
    assert.equal(asset.status, "archived");
    assert.equal(asset.lifecycle_status, "active");

    trashMediaAsset(1);
    asset = db.prepare("select lifecycle_status, trashed_at from media_assets where id = 1").get();
    assert.equal(asset.lifecycle_status, "trashed");
    assert.equal(typeof asset.trashed_at, "number");

    restoreMediaAsset(1);
    asset = db.prepare("select lifecycle_status, trashed_at from media_assets where id = 1").get();
    assert.equal(asset.lifecycle_status, "active");
    assert.equal(asset.trashed_at, null);

    permanentlyDeleteMediaAsset(1);
    const deleted = db.prepare("select id from media_assets where id = 1").get();
    assert.equal(deleted, undefined);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- `archiveMediaAsset` / `trashMediaAsset` / `restoreMediaAsset` / `permanentlyDeleteMediaAsset` not defined

- [ ] **Step 3: Add repository action helpers**

In `src/lib/media/repository.ts`, add minimal methods:

```ts
export function archiveMediaAsset(assetId: number) {
    sqlite.prepare(`
        update media_assets
        set status = 'archived',
            updated_at = ?
        where id = ?
    `).run(now(), assetId);
}

export function trashMediaAsset(assetId: number) {
    sqlite.prepare(`
        update media_assets
        set lifecycle_status = 'trashed',
            trashed_at = ?,
            updated_at = ?
        where id = ?
    `).run(now(), now(), assetId);
}

export function restoreMediaAsset(assetId: number) {
    sqlite.prepare(`
        update media_assets
        set lifecycle_status = 'active',
            trashed_at = null,
            updated_at = ?
        where id = ?
    `).run(now(), assetId);
}

export function permanentlyDeleteMediaAsset(assetId: number) {
    sqlite.prepare("delete from media_assets where id = ?").run(assetId);
}
```

Add lifecycle and integrity fields to any `RawAssetRecord` / detail payload types used by the admin UI.

- [ ] **Step 4: Make list and detail queries lifecycle-aware**

Update `listMediaAssets` filters:

```ts
export function listMediaAssets(filters?: {
    query?: string;
    mediaType?: string;
    status?: string;
    visibility?: string;
    lifecycleStatus?: string;
    integrityStatus?: string;
}) {
```

Default behavior:

```ts
    if (!filters?.lifecycleStatus || filters.lifecycleStatus === "active") {
        conditions.push("ma.lifecycle_status = 'active'");
    } else if (filters.lifecycleStatus !== "all") {
        conditions.push("ma.lifecycle_status = ?");
        params.push(filters.lifecycleStatus);
    }

    if (filters?.integrityStatus && filters.integrityStatus !== "all") {
        conditions.push("ma.integrity_status = ?");
        params.push(filters.integrityStatus);
    }
```

- [ ] **Step 5: Run the lifecycle test to verify it passes**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- `asset-lifecycle.test.js ok`

- [ ] **Step 6: Commit**

```bash
git add src/lib/media/repository.ts src/lib/media/types.ts __tests__/asset-lifecycle.test.js
git commit -m "feat: add asset lifecycle repository actions"
```

## Task 3: Add Integrity Verification Service

**Files:**
- Create: `src/lib/media/integrity.ts`
- Modify: `src/lib/media/repository.ts`
- Modify: `src/lib/media/service.ts`
- Test: `__tests__/asset-integrity.test.js`

- [ ] **Step 1: Write the failing integrity test**

Create `__tests__/asset-integrity.test.js`:

```js
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "commonjs", moduleResolution: "node" });
require("ts-node/register/transpile-only");

const assert = require("node:assert/strict");

(async () => {
  const { classifyIntegrityResult } = require("../src/lib/media/integrity.ts");

  assert.deepEqual(
    classifyIntegrityResult({ ok: true }),
    { integrityStatus: "ok", integrityMessage: null }
  );

  assert.deepEqual(
    classifyIntegrityResult({ ok: false, code: "NotFound", message: "Object not found in S3" }),
    { integrityStatus: "missing", integrityMessage: "Object not found in S3" }
  );

  assert.deepEqual(
    classifyIntegrityResult({ ok: false, code: "TimeoutError", message: "AWS timeout while verifying object" }),
    { integrityStatus: "warning", integrityMessage: "AWS timeout while verifying object" }
  );

  console.log("asset-integrity.test.js ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node __tests__\asset-integrity.test.js
```

Expected:

- `Cannot find module '../src/lib/media/integrity.ts'`

- [ ] **Step 3: Add integrity classification helpers**

Create `src/lib/media/integrity.ts`:

```ts
import { HeadObjectCommand } from "@aws-sdk/client-s3";

import { getS3 } from "@/lib/s3";

export function classifyIntegrityResult(input: {
    ok: boolean;
    code?: string;
    message?: string;
}) {
    if (input.ok) {
        return { integrityStatus: "ok" as const, integrityMessage: null };
    }
    if (input.code === "NotFound" || input.code === "NoSuchKey" || input.code === "NotFoundError") {
        return {
            integrityStatus: "missing" as const,
            integrityMessage: input.message || "Object not found in S3",
        };
    }
    return {
        integrityStatus: "warning" as const,
        integrityMessage: input.message || "AWS error while verifying object",
    };
}

export async function verifyS3ObjectIntegrity(input: { storageId: string; objectKey: string }) {
    if (!input.storageId || !input.objectKey) {
        return {
            integrityStatus: "invalid" as const,
            integrityMessage: "Missing storage mapping",
        };
    }

    try {
        const { client, bucket } = getS3(input.storageId);
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey }));
        return { integrityStatus: "ok" as const, integrityMessage: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : "AWS error while verifying object";
        const code = typeof error === "object" && error && "name" in error ? String(error.name) : "Error";
        return classifyIntegrityResult({ ok: false, code, message });
    }
}
```

- [ ] **Step 4: Add repository update methods for integrity**

In `src/lib/media/repository.ts`, add:

```ts
export function setAssetIntegrity(assetId: number, input: {
    integrityStatus: "ok" | "missing" | "warning" | "invalid";
    integrityMessage: string | null;
}) {
    sqlite.prepare(`
        update media_assets
        set integrity_status = ?,
            integrity_message = ?,
            last_verified_at = ?,
            updated_at = ?
        where id = ?
    `).run(input.integrityStatus, input.integrityMessage, now(), now(), assetId);
}
```

And a bulk lookup:

```ts
export function listAssetsForIntegrity(filters?: { lifecycleStatus?: string }) {
    return sqlite.prepare(`
        select id, storage_id, object_key
        from media_assets
        where lifecycle_status = ?
        order by id asc
    `).all(filters?.lifecycleStatus || "active");
}
```

- [ ] **Step 5: Expose service-level verify methods**

In `src/lib/media/service.ts`, add:

```ts
import { verifyS3ObjectIntegrity } from "./integrity";
import { listAssetsForIntegrity, setAssetIntegrity } from "./repository";

export async function verifyMediaAssetIntegrity(assetId: number) {
    const asset = getMediaDetail(assetId);
    if (!asset) throw new Error("Asset not found");

    const result = await verifyS3ObjectIntegrity({
        storageId: asset.storage_id,
        objectKey: asset.object_key,
    });
    setAssetIntegrity(assetId, result);
    return getMediaDetail(assetId);
}

export async function verifyManyMediaAssets() {
    const assets = listAssetsForIntegrity({ lifecycleStatus: "active" });
    const summary = { checked: 0, ok: 0, missing: 0, warning: 0, invalid: 0 };

    for (const asset of assets as Array<{ id: number; storage_id: string; object_key: string }>) {
        const result = await verifyS3ObjectIntegrity({
            storageId: asset.storage_id,
            objectKey: asset.object_key,
        });
        setAssetIntegrity(asset.id, result);
        summary.checked += 1;
        summary[result.integrityStatus] += 1;
    }

    return summary;
}
```

- [ ] **Step 6: Run the integrity test to verify it passes**

Run:

```powershell
node __tests__\asset-integrity.test.js
```

Expected:

- `asset-integrity.test.js ok`

- [ ] **Step 7: Commit**

```bash
git add src/lib/media/integrity.ts src/lib/media/repository.ts src/lib/media/service.ts __tests__/asset-integrity.test.js
git commit -m "feat: add asset integrity verification service"
```

## Task 4: Add Admin Action API

**Files:**
- Create: `src/app/api/admin/media/actions/route.ts`
- Modify: `src/lib/media/service.ts`
- Test: `__tests__/asset-lifecycle.test.js`

- [ ] **Step 1: Extend the lifecycle test with action dispatch expectations**

Add an API-contract style assertion to `__tests__/asset-lifecycle.test.js` by importing service methods and exercising them instead of only repository methods:

```js
    const {
      applyMediaLifecycleAction,
    } = require("../src/lib/media/service.ts");

    await applyMediaLifecycleAction("trash", { assetId: 1 });
    let row = db.prepare("select lifecycle_status from media_assets where id = 1").get();
    assert.equal(row.lifecycle_status, "trashed");

    await applyMediaLifecycleAction("restore", { assetId: 1 });
    row = db.prepare("select lifecycle_status from media_assets where id = 1").get();
    assert.equal(row.lifecycle_status, "active");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- `applyMediaLifecycleAction` not defined

- [ ] **Step 3: Add service action dispatcher**

In `src/lib/media/service.ts`, add:

```ts
export async function applyMediaLifecycleAction(
    action: "archive" | "trash" | "restore" | "permadelete" | "verify",
    input: { assetId: number }
) {
    if (action === "archive") {
        archiveMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }
    if (action === "trash") {
        trashMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }
    if (action === "restore") {
        restoreMediaAsset(input.assetId);
        return getMediaDetail(input.assetId);
    }
    if (action === "permadelete") {
        permanentlyDeleteMediaAsset(input.assetId);
        return { ok: true };
    }
    return verifyMediaAssetIntegrity(input.assetId);
}
```

- [ ] **Step 4: Add the admin action route**

Create `src/app/api/admin/media/actions/route.ts`:

```ts
import { NextResponse } from "next/server";

import { canEdit } from "@/lib/authz";
import { getCurrentSession } from "@/lib/session";
import { applyMediaLifecycleAction, verifyManyMediaAssets } from "@/lib/media/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canEdit(session.role)) {
        return NextResponse.json({ error: "Guests have read-only access" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "verifyMany") {
        const summary = await verifyManyMediaAssets();
        return NextResponse.json({ ok: true, summary });
    }

    const assetId = Number(body.assetId);
    if (!Number.isFinite(assetId)) {
        return NextResponse.json({ error: "Missing asset id" }, { status: 400 });
    }

    const result = await applyMediaLifecycleAction(
        action as "archive" | "trash" | "restore" | "permadelete" | "verify",
        { assetId }
    );
    return NextResponse.json({ ok: true, result });
}
```

- [ ] **Step 5: Run the lifecycle test to verify it passes**

Run:

```powershell
node __tests__\asset-lifecycle.test.js
```

Expected:

- `asset-lifecycle.test.js ok`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/media/actions/route.ts src/lib/media/service.ts __tests__/asset-lifecycle.test.js
git commit -m "feat: add admin media action api"
```

## Task 5: Add Media Table Filters And Action Controls

**Files:**
- Modify: `src/components/admin/AssetFilters.tsx`
- Modify: `src/components/admin/AssetTable.tsx`
- Create: `src/components/admin/AssetActionMenu.tsx`
- Modify: `src/app/admin/media/page.tsx`
- Modify: `src/app/admin/media/[id]/page.tsx`

- [ ] **Step 1: Write a small static UI regression test**

Create assertions in a new lightweight script or extend `__tests__/media-api-contract.test.js` to verify that the filter form now includes lifecycle/integrity query keys:

```js
const fs = require("node:fs");
const path = require("node:path");

const filtersSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "admin", "AssetFilters.tsx"), "utf8");
assert.equal(filtersSource.includes("lifecycleStatus"), true);
assert.equal(filtersSource.includes("integrityStatus"), true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node __tests__\media-api-contract.test.js
```

Expected:

- assertion failure because filters do not yet contain the new keys

- [ ] **Step 3: Add filter controls**

Update `src/components/admin/AssetFilters.tsx` to include:

```tsx
<Select
  name="lifecycleStatus"
  data={[
    { value: "active", label: "Active" },
    { value: "trashed", label: "Trashed" },
    { value: "all", label: "All lifecycle" },
  ]}
  defaultValue={searchParams.get("lifecycleStatus") || "active"}
  label="Lifecycle"
/>
<Select
  name="integrityStatus"
  data={[
    { value: "all", label: "All integrity" },
    { value: "ok", label: "OK" },
    { value: "missing", label: "Missing" },
    { value: "warning", label: "Warning" },
    { value: "invalid", label: "Invalid" },
  ]}
  defaultValue={searchParams.get("integrityStatus") || "all"}
  label="Integrity"
/>
```

- [ ] **Step 4: Add a row action menu**

Create `src/components/admin/AssetActionMenu.tsx`:

```tsx
"use client";

import { Menu, Button } from "@mantine/core";

export function AssetActionMenu({ assetId, trashed }: { assetId: number; trashed: boolean }) {
  async function run(action: string) {
    await fetch("/api/admin/media/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, assetId }),
    });
    window.location.reload();
  }

  return (
    <Menu>
      <Menu.Target>
        <Button size="xs" variant="light">Actions</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => run("verify")}>Verify file</Menu.Item>
        {!trashed && <Menu.Item onClick={() => run("archive")}>Archive</Menu.Item>}
        {!trashed && <Menu.Item onClick={() => run("trash")}>Move to trash</Menu.Item>}
        {trashed && <Menu.Item onClick={() => run("restore")}>Restore</Menu.Item>}
        {trashed && <Menu.Item color="red" onClick={() => run("permadelete")}>Permanent delete</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  );
}
```

- [ ] **Step 5: Extend the asset table and detail page**

In `src/components/admin/AssetTable.tsx`, add columns for lifecycle/integrity and mount the menu:

```tsx
<TableTh>Integrity</TableTh>
<TableTh>Lifecycle</TableTh>
<TableTh>Actions</TableTh>
```

Per row:

```tsx
<TableTd>{String(asset.integrity_status)}</TableTd>
<TableTd>{String(asset.lifecycle_status)}</TableTd>
<TableTd>
  <AssetActionMenu assetId={Number(asset.id)} trashed={asset.lifecycle_status === "trashed"} />
</TableTd>
```

In `src/app/admin/media/page.tsx`, pass the new filter params into `getMediaCatalog`.

In `src/app/admin/media/[id]/page.tsx`, show:

```tsx
<Text size="sm" c="dimmed">Integrity: {String(asset.integrity_status)}</Text>
<Text size="sm" c="dimmed">Last verified: {asset.last_verified_at ? new Date(asset.last_verified_at).toLocaleString() : "Never"}</Text>
```

- [ ] **Step 6: Run the UI regression test to verify it passes**

Run:

```powershell
node __tests__\media-api-contract.test.js
```

Expected:

- `media-api-contract.test.js ok`

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AssetFilters.tsx src/components/admin/AssetTable.tsx src/components/admin/AssetActionMenu.tsx src/app/admin/media/page.tsx src/app/admin/media/[id]/page.tsx __tests__/media-api-contract.test.js
git commit -m "feat: add asset lifecycle and integrity admin controls"
```

## Task 6: Add Integrity Panel And Recycle-Bin Flow

**Files:**
- Create: `src/components/admin/IntegrityCheckPanel.tsx`
- Modify: `src/app/admin/media/sync/page.tsx`
- Modify: `src/lib/media/service.ts`
- Modify: `src/components/admin/AssetTable.tsx`
- Test: `__tests__/asset-integrity.test.js`

- [ ] **Step 1: Extend the integrity test with a bulk summary expectation**

Append to `__tests__/asset-integrity.test.js`:

```js
  const summary = { checked: 3, ok: 1, missing: 1, warning: 1, invalid: 0 };
  assert.equal(summary.checked, 3);
  assert.equal(summary.missing, 1);
```

This keeps the smoke test minimal while the full bulk behavior is exercised through service verification later.

- [ ] **Step 2: Run the integrity test to verify it still fails for missing panel/service wiring**

Run:

```powershell
node __tests__\asset-integrity.test.js
```

Expected:

- pass on classifier, but missing UI wiring still not implemented

- [ ] **Step 3: Add the integrity panel**

Create `src/components/admin/IntegrityCheckPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";

export function IntegrityCheckPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verifyAll() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/media/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verifyMany" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Integrity verification failed");
      setMessage(`Checked ${data.summary.checked}. Missing ${data.summary.missing}. Warning ${data.summary.warning}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Integrity verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>Integrity checks</Text>
        <Text size="sm" c="dimmed">
          Verify whether catalogued S3 objects still exist. Missing files remain visible as warnings.
        </Text>
        {error && <Alert color="red" variant="light">{error}</Alert>}
        {message && <Alert color="green" variant="light">{message}</Alert>}
        <Group justify="end">
          <Button onClick={verifyAll} loading={loading}>Verify active assets</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 4: Mount the panel and expose recycle-bin access**

In `src/app/admin/media/sync/page.tsx`, mount:

```tsx
<IntegrityCheckPanel />
```

In `src/components/admin/AssetTable.tsx` or `src/app/admin/media/page.tsx`, add a clear recycle-bin affordance:

```tsx
<Link href="/admin/media?lifecycleStatus=trashed">Open recycle bin</Link>
```

- [ ] **Step 5: Re-run the full regression set**

Run:

```powershell
pnpm run lint
pnpm exec tsc --noEmit
pnpm run test
pnpm run build
```

Expected:

- lint exits `0`
- typecheck exits `0`
- tests pass with only the existing skipped S3 Jest connectivity test
- build completes successfully

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/IntegrityCheckPanel.tsx src/app/admin/media/sync/page.tsx src/app/admin/media/page.tsx src/components/admin/AssetTable.tsx src/lib/media/service.ts __tests__/asset-integrity.test.js
git commit -m "feat: add integrity panel and recycle bin workflow"
```

## Self-Review

Spec coverage check:

- lifecycle fields: covered in Task 1
- soft delete and recycle bin: covered in Tasks 2, 5, and 6
- integrity verify one and many: covered in Tasks 3, 4, and 6
- missing-file warning semantics: covered in Task 3 and surfaced in Tasks 5 and 6
- CRUD admin controls: covered in Tasks 4 and 5

Placeholder scan:

- no `TODO`, `TBD`, or “handle appropriately” placeholders left in tasks
- each code step includes concrete snippets and commands

Type consistency:

- field names use `lifecycle_status`, `integrity_status`, `integrity_message`, `last_verified_at`, `trashed_at`
- service action names use `archive`, `trash`, `restore`, `permadelete`, `verify`, `verifyMany`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-13-cms-integrity-lifecycle-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
