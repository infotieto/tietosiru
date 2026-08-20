import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const publicPages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/public" }),
  schema: z.object({ title: z.string().optional(), description: z.string().optional() }),
});

export const collections = { public: publicPages };
