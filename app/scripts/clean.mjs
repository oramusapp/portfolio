// Removes the previous build from the repository root before `vite build` writes the new one.
import { rmSync, readdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
rmSync(new URL('assets', root), { recursive: true, force: true });
for (const f of readdirSync(root)) if (/^(sw\.js|workbox-.*\.js|registerSW\.js|manifest\.webmanifest)$/.test(f)) rmSync(new URL(f, root));
