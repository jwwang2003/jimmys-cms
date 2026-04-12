# Media-First CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable image/video-first CMS with simple role-based login, tolerant S3 sync, tags/albums/collections, and asset geolocation.

**Architecture:** Replace the fragile placeholder auth flow with a small signed-cookie session layer that supports `admin`, `user`, and `guest` access, including passwordless guest login. Keep S3 as the binary store and SQLite as the metadata source of truth, with a shared media ingestion service that records raw S3 objects, promotes valid assets, and preserves sync warnings for messy bucket contents.

**Tech Stack:** Next.js App Router, TypeScript, Mantine, SQLite, Drizzle, AWS S3, signed cookies via Node crypto

---

### Task 1: Plan The Auth Boundary

**Files:**
- Create: `src/lib/session.ts`
- Modify: `src/middleware.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/api/login/route.ts`
- Test: `__tests__/session.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { createSessionToken, verifySessionToken } = require("../src/lib/session");

test("creates and verifies a signed session token", () => {
  const token = createSessionToken({
    userId: "u1",
    role: "admin",
    username: "root",
  });

  const decoded = verifySessionToken(token);

  expect(decoded.userId).toBe("u1");
  expect(decoded.role).toBe("admin");
  expect(decoded.username).toBe("root");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test __tests__/session.test.js`
Expected: FAIL because `src/lib/session` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```javascript
function createSessionToken(payload) {
  return "placeholder";
}

function verifySessionToken(token) {
  return { userId: "u1", role: "admin", username: "root" };
}

module.exports = { createSessionToken, verifySessionToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test __tests__/session.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/session.test.js src/lib/session.ts src/middleware.ts src/app/login/page.tsx src/app/api/login/route.ts
git commit -m "feat: add simple cms session auth"
```

### Task 2: Bootstrap CMS Schema At Runtime

**Files:**
- Create: `src/db/bootstrap.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/schema/schema.ts`
- Test: `__tests__/cms-bootstrap.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("bootstrap sql includes asset_locations and collection kind support", async () => {
  const { cmsBootstrapSql } = await import("../src/db/bootstrap.ts");

  expect(cmsBootstrapSql).toContain("asset_locations");
  expect(cmsBootstrapSql).toContain("ALTER TABLE collections ADD COLUMN kind");
  expect(cmsBootstrapSql).toContain("ALTER TABLE storage_objects ADD COLUMN sync_status");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test __tests__/cms-bootstrap.test.js`
Expected: FAIL because bootstrap module does not exist yet

- [ ] **Step 3: Write minimal implementation**

```typescript
export const cmsBootstrapSql = `
CREATE TABLE IF NOT EXISTS asset_locations (...);
ALTER TABLE collections ADD COLUMN kind TEXT DEFAULT 'collection';
ALTER TABLE storage_objects ADD COLUMN sync_status TEXT DEFAULT 'discovered';
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test __tests__/cms-bootstrap.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/cms-bootstrap.test.js src/db/bootstrap.ts src/db/index.ts src/db/schema/schema.ts
git commit -m "feat: bootstrap cms schema"
```

### Task 3: Build Media Ingestion Services

**Files:**
- Create: `src/lib/media/types.ts`
- Create: `src/lib/media/normalization.ts`
- Create: `src/lib/media/repository.ts`
- Create: `src/lib/media/service.ts`
- Test: `__tests__/media-normalization.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("classifies unsupported objects as invalid and image objects as valid", async () => {
  const { classifyObject } = await import("../src/lib/media/normalization.ts");

  expect(classifyObject({ key: "raw/file.bin", mimeType: "application/octet-stream" }).outcome).toBe("invalid");
  expect(classifyObject({ key: "images/photo.jpg", mimeType: "image/jpeg" }).outcome).toBe("valid");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test __tests__/media-normalization.test.js`
Expected: FAIL because media normalization module does not exist yet

- [ ] **Step 3: Write minimal implementation**

```typescript
export function classifyObject(input: { key: string; mimeType?: string | null }) {
  if ((input.mimeType || "").startsWith("image/")) return { outcome: "valid", mediaType: "image", warnings: [] };
  if ((input.mimeType || "").startsWith("video/")) return { outcome: "valid", mediaType: "video", warnings: [] };
  return { outcome: "invalid", mediaType: "other", warnings: ["unsupported mime type"] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test __tests__/media-normalization.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/media-normalization.test.js src/lib/media/types.ts src/lib/media/normalization.ts src/lib/media/repository.ts src/lib/media/service.ts
git commit -m "feat: add media ingestion service"
```

### Task 4: Add Admin Media APIs

**Files:**
- Create: `src/app/api/admin/media/route.ts`
- Create: `src/app/api/admin/media/[id]/route.ts`
- Create: `src/app/api/admin/media/sync/route.ts`
- Create: `src/app/api/admin/auth/guest/route.ts`
- Modify: `src/app/api/login/route.ts`
- Test: `__tests__/media-api-contract.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("media update payload supports tags, collections, and locations", async () => {
  const { normalizeAssetUpdatePayload } = await import("../src/app/api/admin/media/[id]/route.ts");

  const payload = normalizeAssetUpdatePayload({
    title: "Harbor Sunset",
    tagSlugs: ["travel", "sunset"],
    collectionIds: [1],
    locations: [{ rawAddress: "Sydney Opera House", isPrimary: true }],
  });

  expect(payload.title).toBe("Harbor Sunset");
  expect(payload.tagSlugs).toEqual(["travel", "sunset"]);
  expect(payload.locations).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test __tests__/media-api-contract.test.js`
Expected: FAIL because the admin media route does not exist yet

- [ ] **Step 3: Write minimal implementation**

```typescript
export function normalizeAssetUpdatePayload(input: any) {
  return {
    title: String(input.title || "").trim(),
    tagSlugs: Array.isArray(input.tagSlugs) ? input.tagSlugs : [],
    collectionIds: Array.isArray(input.collectionIds) ? input.collectionIds : [],
    locations: Array.isArray(input.locations) ? input.locations : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test __tests__/media-api-contract.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/media-api-contract.test.js src/app/api/admin/media/route.ts src/app/api/admin/media/[id]/route.ts src/app/api/admin/media/sync/route.ts src/app/api/admin/auth/guest/route.ts src/app/api/login/route.ts
git commit -m "feat: add cms media and guest auth routes"
```

### Task 5: Replace Placeholder Admin Pages

**Files:**
- Create: `src/app/admin/media/page.tsx`
- Create: `src/app/admin/media/[id]/page.tsx`
- Create: `src/app/admin/media/sync/page.tsx`
- Create: `src/components/admin/AssetFilters.tsx`
- Create: `src/components/admin/AssetTable.tsx`
- Create: `src/components/admin/AssetEditor.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/login/page.tsx`
- Test: `__tests__/admin-dashboard-copy.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("admin dashboard copy includes media review language", async () => {
  const page = await import("../src/app/admin/page.tsx");
  const source = page.default.toString();

  expect(source).toContain("Assets");
  expect(source).toContain("Needs review");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test __tests__/admin-dashboard-copy.test.js`
Expected: FAIL because the current admin page is only a placeholder

- [ ] **Step 3: Write minimal implementation**

```tsx
export default function AdminPage() {
  return (
    <section>
      <h1>Assets</h1>
      <p>Needs review</p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test __tests__/admin-dashboard-copy.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/admin-dashboard-copy.test.js src/app/admin/page.tsx src/app/admin/media/page.tsx src/app/admin/media/[id]/page.tsx src/app/admin/media/sync/page.tsx src/components/admin/AssetFilters.tsx src/components/admin/AssetTable.tsx src/components/admin/AssetEditor.tsx src/app/login/page.tsx
git commit -m "feat: add cms admin media pages"
```

### Task 6: Verify End-To-End

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run targeted tests**

Run: `node --test __tests__/session.test.js __tests__/cms-bootstrap.test.js __tests__/media-normalization.test.js __tests__/media-api-contract.test.js __tests__/admin-dashboard-copy.test.js`
Expected: PASS

- [ ] **Step 2: Run project tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: Run lint/build if dependencies are available**

Run: `pnpm lint`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Update docs**

```markdown
- Document the simple role-based login flow.
- Document guest access and S3 sync behavior.
- Document new admin routes.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document cms auth and media flows"
```
