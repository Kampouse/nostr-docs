// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://nostr.dev',

  integrations: [
    starlight({
      title: 'Nostr Docs',
      description: 'Everything you need to understand and build on Nostr',

      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/nostr-protocol/nips' },
      ],

      sidebar: [
        {
          label: 'Getting Started',
          items: [
            'getting-started/what-is-nostr',
            'getting-started/keys-and-identity',
            'getting-started/how-relays-work',
            'getting-started/your-first-note',
          ],
        },
        {
          label: 'Concepts',
          items: [
            'concepts/events',
            'concepts/signatures',
            'concepts/filters-and-subscriptions',
            'concepts/how-nips-fit-together',
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: '🗺️ NIP Dependency Graph', link: '/nip-graph/' },
            'reference/event-kinds',
            'reference/tags',
            'reference/message-types',
            {
              label: 'NIP Specifications',
              items: [{ autogenerate: { directory: 'nips' } }],
            },
          ],
        },
      ],

      customCss: ['./src/styles/custom.css'],
    }),
    mdx(),
  ],
});
