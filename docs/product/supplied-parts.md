# Supplied part source records

Henry supplied two distinct products on 26 September 2026. Pairing below is based on his statement and matching base filenames; the native model/drawing references have not been verified by a CAD application. Keep each product in its own job. Original binaries stay outside the public repository.

| Product | Source filename | Bytes | SHA-256 |
|---|---|---:|---|
| Engineering test block | Engineering test block.SLDPRT | 72,862 | `84caba2a1fdd765b6c2c9367e63beaf4843c5f4a5eedd4fa5ad80ee211f0b365` |
| Engineering test block | Engineering test block.SLDDRW | 257,362 | `0dd4575ceaefbdbd341f4a40b5e97c8584c9edba257229322d69ebae5547ac35` |
| manufacturing test sheet | manufacturing test sheet.SLDPRT | 78,565 | `6fe3c8f55b65d726b3d4da0c87a9c4a166db740198f3cdd4da54d089690294ca` |
| manufacturing test sheet | manufacturing test sheet.SLDDRW | 257,310 | `f563f964b0168f83160a0c57c5751e92c6611d06d214d47a39a31b0ded57f367` |

## Readable Engineering Test Block packet

Henry later supplied a readable export pair for the Engineering Test Block. The originals remain outside the repository and the archived static prototype lists these files by record only; it does not publish their bytes.

| Source filename | Bytes | SHA-256 | App role |
|---|---:|---|---|
| Engineering test block (1).pdf | 104,740 | `e2b8acdac23131edbbb1f2e99e18d2bf172a99ad191c1b6d84e5536a480a7646` | Readable drawing evidence for the generic pitch analysis |
| Engineering test block (1).STL | 31,284 | `f4e2e704000e19a0de8999e334faf47ee59c533f74d4f48fb7f9a68003d29fa4` | Browser-viewable, visual-only model reference |

The PDF is one A3 page produced by SOLIDWORKS PDF Publisher. Its extracted/visually checked drawing content establishes millimetres, a 60 × 60 × 60 mm envelope, Ø10 mm typical holes, 15 mm and 30 mm callouts, and a Rev1 title block. It does **not** state a material or finish; the app must surface those as unresolved engineering decisions. The binary STL has 624 facets and a 60 × 60 × 60 mm mesh bounding box. Mesh bounds are useful to frame the visual viewer only; they never become semantic AI evidence or manufacturing specification.

## Intake and readiness

The authenticated intake accepts `native_part` (`.SLDPRT`) and `native_drawing` (`.SLDDRW`) as private, opaque sources, up to 50 MiB each. A native pair can be saved before viewable exports exist. Upload completion verifies byte count and records a SHA-256 hash; this is not CAD validation. Download responses use `attachment` and `nosniff`. No native bytes are sent as AI text or treated as a PDF/GLB.

Drawing PDF exports are needed for the implemented drawing extraction and AI path; GLB and STL are both accepted for the browser model. An authored bend manifest remains an additional requirement of the existing bend-guide generation path. The Engineering Test Block now has the readable PDF/STL pair above, but the manufacturing test sheet still needs a readable drawing export and a viewable model. Do not substitute the prepared Sensor Mount assets or invent dimensions/features for either supplied product. A cached native thumbnail, if recoverable, is only a source preview, not a legible technical drawing or interactive 3D model.

At initial inspection, all four files were readable but macOS `file` identified them as opaque data. None contained literal OLE, ZIP, PNG, JPEG, or PDF signatures. Their header version bytes are `00 00 00 04`, consistent with the compressed block envelope described by the [cadmpeg format research](https://github.com/cadmpeg/cadmpeg/blob/main/docs/formats/sldprt.md), attributed to the cadmpeg project (CC BY 4.0). This suggests compressed previews may exist; it does not establish conversion support.

## Conversion options to evaluate

The Engineering Test Block exports are available, but do not assume an equivalent export exists for the manufacturing test sheet. [CAD Exchanger documents SolidWorks-to-GLB conversion](https://cadexchanger.com/solidworks-to-glb/) for parts/assemblies; that does not establish native drawing conversion or successful processing of the remaining native-only files. [eDrawings documents native SolidWorks drawing and part viewing](https://help.solidworks.com/2022/english/eDrawings/t_Opening_Files.htm?id=2.0.2.1). A compatible local viewer/converter should be tested before adding a conversion claim. No third-party service has received the files and no converter is configured by this change.

## Local source-preview recovery

A bounded local scanner successfully inflated and CRC-checked genuine `PreviewPNG` sections in all four files and `Images/Sheet_0` sections in both drawings. The extracted model thumbnails visibly differ and match the two supplied file groups; they are cached views, not reconstructed geometry. Images remain private local outputs. Drawing preview legibility is limited; small notes and tolerances cannot be reliably verified from these cached images alone. The new authenticated `GET /api/assets/:id/preview` reads only a member-authorized native source, rechecks its size and hash, and extracts a cached PNG with decompressed-size, CRC, PNG dimension and work limits. Unsupported files return an explicit error. The server never passes preview pixels to the text-evidence AI path. The intake/preview source implementation still requires deployment.

The dependency-free local command is `node scripts/extract-solidworks-previews.mts OUTPUT_DIRECTORY SOURCE.SLDPRT SOURCE.SLDDRW`. It writes cached PNGs and a source-hash manifest; it neither modifies the originals nor interprets geometry. This recovered all four supplied previews. Keep its output outside the public repository.

Intake UI verification reused the existing task form, `Button`/`StatusBadge`, and `jobs.module.css` tokens without adding a new visual pattern. A local-only preview with mocked workshop responses was inspected at 1440, 390, and 320 px, with no horizontal overflow. Native-pair saving, retained-only labels, and export-needed copy have component coverage. The authenticated service and migration still require deployment verification.
