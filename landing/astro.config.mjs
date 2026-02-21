import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://cursorlens.github.io',
  base: '/CursorLens/',
  integrations: [tailwind()],
});
