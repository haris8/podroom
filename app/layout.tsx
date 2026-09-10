import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Podroom — Your personal audio studio', description: 'Turn text, articles, PDFs, and Word documents into narrated episodes. Choose a voice and listen in your browser.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
