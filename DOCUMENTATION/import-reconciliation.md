# Import reconciliation — spreadsheets vs. site vs. masters

Satisfies plan §2: *"every spreadsheet row is either an asset row or explicitly
marked out of scope with a written reason."*

Sources compared:

| Source | Path |
| --- | --- |
| Photography sheet | `data/photography_v1_0.xlsx` |
| Artwork sheet | `data/artwork_v1_0.xlsx` |
| Site catalog | `glorialan.com/app/photo/photo-data.ts` (`PHOTOS`) |
| Masters | `glorialan.com/assets-master/originals/**` |

---

## The "~160 vs 111" gap does not exist

The plan carries a row gap forward from an earlier count: *"the spreadsheet
holds ~160 rows against the 111 records in glorialan.com's photo-data.ts."*
Both numbers are artifacts of how they were measured.

**~160** is the sheet's declared dimension, not its content. `!ref` on the
photography sheet reads `A1:L160`, but only 111 rows are populated — a banner
row, a header row, and **109 data rows**. The remaining ~49 are empty rows
inside an oversized saved range. The artwork sheet has the same shape:
`!ref` says `A1:L56`, content is 39 data rows.

**111** counts `id:` occurrences in `photo-data.ts`, two of which belong to
region/country metadata rather than photos. The array holds **110** records.

Corrected counts:

| | Sheet rows | Site records | Master files |
| --- | --- | --- | --- |
| Photography | 109 (ids 1–109, contiguous, no dupes) | 110 | 110 |
| Artwork | 39 (ids 1–39, contiguous, no dupes) | — | 36 files covering all 39 |

A second incorrect detail in the same plan item: the photography sheet is named
`Sheet1`. `摄影作品信息` is a merged banner in `A1`, spanning `A1:H1`. Header
row is row 2, data starts at row 3. Any importer keying off the sheet name will
find nothing.

## Field-level agreement

Comparing all 109 photography ids against the site catalog on date, city,
place/title, and camera:

```
only in sheet    : none
only in site     : extra-venice
date             : 0 mismatches
city             : 0 mismatches
place            : 0 mismatches
camera           : 0 mismatches
tags             : 1 mismatch
```

The sheet and the site catalog are the same data. The three residual items are
each explained below.

---

## Item 1 — `extra-venice`: a real photo with no spreadsheet row

- **Site:** `id: "extra-venice"`, Venice, 2023-07-22, `camera: "Unknown"`, `tags: []`
- **Master:** `photography/087+Venice+2023-07-22.jpeg`
- **Sheet:** no row

This is the one genuine count difference (109 sheet rows vs. 110 site records
and 110 masters). It was added to the site outside the spreadsheet workflow —
its empty camera and tag fields are the signature of a record that never passed
through the sheet.

The `087` filename prefix is a collision, not an identity: sheet row 087 is
*Santa Maria Gloriosa dei Frari / iPhone 11 Pro*, which owns
`087+Santa Maria Gloriosa dei Frari+2023-07-22.jpeg`. Two distinct files share
the `087` prefix.

**Disposition: in scope.** Import as an asset. It needs a real id allocated
(`110`), and its camera and tags are unknown — recoverable from EXIF at derive
time (§4), since the master exists.

## Item 2 — photo 075's master is misnamed `074`

Two files carry the `074` prefix and no file carries `075`:

| File | Sheet row it actually matches |
| --- | --- |
| `074+西溪高庄+2023-05-01.JPG` | 074 — 西溪高庄 ✓ |
| `074+西湖区+2023-05-01.JPG` | **075 — 西湖区** |

Sheet 074 is 西溪高庄 and sheet 075 is 西湖区; the second file's own embedded
place name identifies it as 075. The site catalog agrees
(`075 … place: "西湖区"`).

**Disposition: in scope, filename is wrong.** All 109 ids have a master. Do
**not** derive from filename prefixes alone — id 075 would silently lose its
master and 074 would get two. Map by place + date, or rename the file to
`075+西湖区+2023-05-01.JPG` before ingest.

## Item 3 — tag drift on photo 016

- Sheet: `coffee, coffee shop`
- Site: `coffee shop`

**Disposition: in scope, sheet wins.** The spreadsheet is the authoring
surface; the site catalog is a generated downstream artifact that dropped a tag.
Import both tags.

---

## Artwork

All 39 ids have master coverage. Two structural notes:

**Composite scans.** Seven ids are covered by both a multi-work scan and an
individual crop:

| Ids | Composite | Individual |
| --- | --- | --- |
| 016–020 | `016-020+watercolor shops+2021-07-25.jpg` | `016.jpg` … `020.jpg` |
| 032–033 | `032-033+watercolor shops+2022-09-19.jpg` | `032.jpg`, `033.jpg` |
| 004–009 | `004-009+watercolor shops+2021-01-28.jpg` | *(none)* |

Ids 004–009 have **only** the composite — six works on one sheet of paper, not
yet cropped. They need either six crops or a stored crop rectangle per work.
This is the one artwork item that is not import-ready.

**Filename date typo.** `039+飞云楼+024-02-04.jpg` reads `024`, not `2024`.
Sheet row 039 gives 2024-02-04. Cosmetic, but it will defeat any date parsed
from the filename.

## Out of scope — support files, not catalog works

Present under `originals/` but deliberately **not** asset rows:

| Path | Count | Reason |
| --- | --- | --- |
| `originals/about-gloria.jpg` | 1 | Site chrome (about page portrait) |
| `originals/artwork-jpg/series-covers/` | 4 | Series cover art, not works |
| `originals/artwork-jpg/architecture-references/` | 4 | Reference photos for drawings |

`orphaned/` (16 files, 25 MB) stays out of the catalog by definition: 3 PDF
originals whose JPEG renders are already catalogued, 7 unlinked architecture
renders, `next.svg`/`vercel.svg` (framework scaffolding), 3 collage
experiments, and `Gloria's photo - website.xlsx` (a superseded copy of the
source spreadsheet). Retained as archive, not published.

---

## Ledger

| Bucket | Count |
| --- | --- |
| Photography sheet rows → assets | 109 |
| Photography, on site + master but not in sheet (`extra-venice`) | 1 |
| **Photography assets total** | **110** |
| Artwork sheet rows → assets | 39 |
| — of which not yet separable from a composite scan (004–009) | 6 |
| Support files, out of scope | 9 |
| Orphaned archive, out of scope | 16 |

Master files: 110 photography + 36 artwork + 9 support = 155 under
`originals/`, matching the plan's §3 figure, plus 16 under `orphaned/`.

**No unexplained rows remain.**

---

## Resolution (applied)

Items 1 and 2 were fixed at the source rather than worked around, so the
filenames now tell the truth and nothing downstream needs a special case:

| Old key | New key |
| --- | --- |
| `photography/074+西湖区+2023-05-01.JPG` | `photography/075+西湖区+2023-05-01.JPG` |
| `photography/087+Venice+2023-07-22.jpeg` | `photography/110+Venice+2023-07-22.jpeg` |

Renamed in `assets-master` first, then uploaded to R2 and verified
byte-for-byte — sha256 read back from the bucket — before the old keys were
deleted. `extra-venice` takes id 110, the next free number.

The photography tree is now 110 files with 110 distinct ids: 001–110 complete,
no duplicates, no gaps.

Item 3 (photo 016's dropped tag) needed no action. The importer merges sheet
tags into whatever the asset already carries, so both `coffee` and
`coffee shop` are present.

The artwork composite ties resolve automatically: where a single-work crop and
the multi-work scan it was cut from both claim an id, the crop wins. Ids
004–009 still resolve to the composite because no crops exist yet, and that
remains the one artwork item that is not import-ready.

### Import result

| | Rows | Matched | Unresolved |
| --- | --- | --- | --- |
| Photography | 109 | 109 | 0 |
| Artwork | 39 | 39 | 0 |

155 `media_assets`, 171 `storage_objects`, 60 tags across 251 links, and 134
`asset_locations` queued for geocoding (no Google Maps key is configured yet).

`media_renditions` is still empty — that is §4.

---

## Path casing

The master trees originally used a capitalised `Photography/` segment beside a
lowercase `artwork-jpg/`. Both are now lowercase:

```
masters/originals/photography/   110 objects
masters/orphaned/photography/      4 objects
```

Object keys are case-sensitive in S3 and R2, so this was a copy-then-delete
rather than a rename — server-side copies, size-verified before anything was
removed. Applied in the same pass to the local `assets-master` tree, the
`media_assets` and `storage_objects` rows, and `r2-upload-receipt.json`.

`assets-master/manifest.json` keeps `oldSrc: "/Photography/…"` unchanged. That
field records where a file used to sit under the *site's* `public/` folder,
which no longer exists in that form; the site's own tree has been
`public/img/photography/` throughout.

**The published catalog did not change.** Content hashes cover what the catalog
says about an asset, and the master's storage key is not part of that — a
private storage path is not something a reader can observe. The publish run
after the rename emitted zero objects, which is the intended behaviour and a
useful check that the internal layout is genuinely decoupled from the public
contract.
