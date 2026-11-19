# HL Names City: POC v2

This is an isometric city playground. Each `.hl` name you own can become a building, and you can generate archipelagos of 0, 100, 1,000 or 10,000 demo buildings to see how the city looks at different scales.

**Connect wallet → see your owned `.hl` names → pick an open plot → a building appears.**

> ⚠️ **Demo buildings are not real.** The 100 / 1,000 / 10,000 presets fill the map with synthetic scenery buildings. They carry no names and do **not** represent on-chain ownership. Only buildings with a purple rim and a name label are real names, placed by the connected wallet.

## Run

Requires Node 18+.

```bash
npm install
npm run dev          # http://localhost:5173
# or
npm run build && npm run preview
```

Open the app in a desktop browser that has an EVM wallet extension, such as Rabby or MetaMask. You can explore and generate worlds without connecting a wallet.

## What you can do

| Control | Behaviour |
| --- | --- |
| **Demo buildings 0 / 100 / 1,000 / 10,000** | Generates a fresh world with that many synthetic buildings. Larger counts add more connected islands, and roughly 20–25% of plots are left open (more at 100). This is destructive: it clears all placements. |
| **Add landmass** | Adds a new irregular island next to the world and links it with a bridge. Its plots start empty. Existing placements are kept. |
| **Regenerate map** | Builds a new layout at the current count and clears all placements. |
| **Click an island → Regenerate landmass** | Replaces just that island's outline, streets, scenery and demo buildings, then builds new bridges. Your buildings on that island are cleared and their names go back to Unplaced. |
| **Reset demo** | Returns to a single empty island and clears all placements. |
| **Place a name** | Select an Unplaced name in the sidebar. Open plots glow; hover one to preview the building, then click it. Press Esc or right-click to cancel. Roads, parks, beaches, occupied plots and water are rejected with a message. A name can only have one building. |
| **Navigate** | Drag or use arrow keys/WASD to pan. Scroll or press `+`/`−` to zoom. **⤢** or `F` shows the whole world, and the minimap jumps the camera. Clicking a Placed name flies to its building. |

Building designs are fixed by the name's namehash: there are 4 families (townhouse, greenhouse, pagoda, cyber tower) × 6 variants, and the same name always gets the same design. Demo buildings use the same 24 sprites, weighted by each island's district theme. For example, towers cluster near the middle of "Neon Heights" islands and pagodas are common on "Lantern Hill".

## `.hl` data source (real, read-only)

Names come from the Hyperliquid Names REST API on HyperEVM mainnet, following the [use-hln-api](https://github.com/HLnames/use-hln-api) skill. This is the same integration POC v1 used, plus a check that each name is still active.

```
GET https://api.hlnames.xyz/utils/names_owner/:address      → [{ name, namehash, tokenid }]   (NFT ownership, not primary name / resolution)
GET https://api.hlnames.xyz/metadata/expiry/:namehash       → { expiry: "<unix seconds>" }
Header: X-API-Key: <key>
```

- **Active check:** names whose expiry is in the past, or `0`, are hidden. If an expiry lookup fails, the name is still shown, marked "expiry unverified".
- The namehash is the stable identity used for building design and for saved placements.
- Names are fetched on connect, on account change, and from ↻. The list has loading, empty and error/retry states. A 404 counts as "owns no names".
- The wallet only calls `eth_requestAccounts` and `eth_accounts`. There are **no signatures, no transactions and no chain switch.**

Optional `.env` (copy `.env.example`): `VITE_HLN_API_BASE` (default `https://api.hlnames.xyz`) and `VITE_HLN_API_KEY` (defaults to the public agent key published in the skill). The key is bundled into the client, so only use a public or read-only key.

## Persistence: local only

Everything is stored in this browser's `localStorage`. There is no backend, shared city, sync or on-chain write.

- **World:** `hlcity2:world` stores `{seed, preset, ops[]}`. Generation is deterministic, so a refresh replays the seed plus the add/regenerate log and gets back the exact same map. No per-building dump is stored.
- **Placements:** `hlcity2:placements:<address>` holds each wallet's records (namehash, tile and island). Records are tagged with the world they belong to:
  - A new world (preset change, Regenerate map, Reset demo) clears every wallet's placements.
  - **Regenerate landmass** clears placements on that island for every wallet in this browser. If a bridge road happens to replace a placed plot, that placement is dropped too.
  - Only the connected wallet's placements are drawn, and only for names it currently owns and that are active. A saved name the wallet no longer owns is not rendered.
- Clearing site data or switching browser loses everything.

## How it's built

TypeScript + Vite + Canvas 2D, with no game engine and no runtime dependencies.

```
src/
  main.ts            app state, UI, wallet flow, placement rules, persistence wiring
  api.ts             HL Names API client (names_owner + expiry)
  wallet.ts          EIP-1193 / EIP-6963 read-only connection
  storage.ts         localStorage: compact world log + per-wallet placements
  rng.ts             seeded RNG + value noise
  world/world.ts     tile grid, landmass/bridge model, district themes
  world/gen.ts       island shapes, archipelago layout, bridges, streets, districts, demo population
  render/renderer.ts camera, chunk baking + LOD, overlays, labels, minimap, picking
  art/core.ts        iso drawing toolkit (faces, textures, lighting, mipmaps)
  art/buildings.ts   the 4 building families × 6 variants
  art/nature.ts      trees, props, landmarks (fountain, lighthouse, clock tower, obelisk, windmill, gazebo)
  art/ground.ts      grass, sand, roads (16 junction masks), plots, plazas, cliffs, bridges
```

**Generation.** Each island is made from 2–4 overlapping blobs along a bent spine, plus value-noise erosion, carved coves, cellular smoothing and the occasional pond. Islands are packed next to a parent island with at least 3 water tiles between them and joined by straight bridges, typically 4–12 tiles long. Each island gets a street grid with its own block size and merged blocks, then plots along the streets, parks, a central plaza with a landmark, a beach or grassy coastline, and sometimes a lighthouse.

**Performance at 10,000 buildings.** The map is split into 16×16-tile chunks. Each chunk (terrain, shadows, trees and buildings) is baked into an offscreen canvas once per power-of-two zoom level, and every frame just copies the visible chunks. Missing chunks are baked within a per-frame time budget; until then a chunk baked at another zoom level stands in. A pixel budget evicts least-recently-used chunks. Only overlays (hover, placement highlights, labels, pins) are drawn live. Labels only appear for real names, and below about 0.42 zoom they become pins. Generating a 10k world (~45 islands, ~12.6k plots) takes about 0.2–0.5 s.

## Art direction and references

The four `reference *.png` images in the repo set the target: detailed isometric buildings with crisp outlines, layered materials (brick, siding, timber, glass curtain walls), lit windows, neon accents, rooftop gardens and lush vegetation. That is the "64-bit" look, as opposed to the chunky 8/16-bit pixels of POC v1.

All art is painted procedurally in code at 2× resolution: textured faces, gradient lighting from the upper left, ambient occlusion, cast shadows, then mipmaps. No images are bundled, and there are no AI-generated cutouts or third-party assets.
