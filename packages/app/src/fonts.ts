import { IBM_Plex_Mono, Inter, Roboto, Roboto_Mono } from 'next/font/google';

export const ibmPlexMono = IBM_Plex_Mono({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const robotoMono = Roboto_Mono({
  weight: ['100', '300', '400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-roboto-mono',
  display: 'swap',
});

export const inter = Inter({
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const roboto = Roboto({
  weight: ['100', '300', '400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
});
