import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Tamagochi Me',
    short_name: 'Tamagochi Me',
    description: 'Habits tracker com evolução Tamagochi e dashboard central.',
    start_url: '/',
    display: 'standalone',
    background_color: '#08101a',
    theme_color: '#08101a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Registrar água', url: '/?quick=water' },
      { name: 'Marcar treino', url: '/?quick=gym' },
    ],
  };
}
