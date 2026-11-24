import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MUSIKU+ Admin Dashboard',
  description: 'MUSIKU+ administration — users, providers, catalog, subscriptions, logs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
