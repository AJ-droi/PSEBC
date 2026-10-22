import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PSEBC Lifts',
    short_name: 'PSEBC Lifts',
    description: 'Lifts to Princes Street Church from checked volunteer drivers.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F6F8F6',
    theme_color: '#1E4927',
    lang: 'en-GB',
    categories: ['lifestyle', 'social'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Book a lift', url: '/member/book', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My trips', url: '/driver', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
