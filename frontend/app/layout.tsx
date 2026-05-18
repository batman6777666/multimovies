import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Web Page Inspector',
  description: 'Inspect web pages and extract pattern links',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
