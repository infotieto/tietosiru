import { defineConfig } from 'astro/config';

import netlify from '@astrojs/netlify';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

const DEV_PORT = 2121;

// https://astro.build/config
export default defineConfig({
	site: process.env.CI
		? 'https://themesberg.github.io'
		: `http://localhost:${DEV_PORT}`,
	base: process.env.CI ? '/flowbite-astro-admin-dashboard' : undefined,

	// Hybrid by default in Astro 7: static unless prerender = false
	output: 'static',
	adapter: netlify(),

	server: {
		port: DEV_PORT,
	},

	integrations: [
		sitemap(),
	],

	vite: {
		plugins: [tailwindcss()],
	},
});
