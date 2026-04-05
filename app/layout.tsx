import type { Metadata } from 'next'
import './globals.css'
import { GoogleAnalytics } from '@next/third-parties/google'

const siteUrl = 'https://alpa.mindrasolutions.com'
const defaultTitle = 'ALPA by MINDRA | Lead Generation & Prospecting Platform'
const defaultDescription =
  'ALPA is a lead generation and prospecting platform that helps you find and access verified business contacts faster.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: '%s | ALPA by MINDRA',
  },
  description: defaultDescription,
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'ALPA by MINDRA',
    title: defaultTitle,
    description: defaultDescription,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'ALPA by MINDRA lead generation and prospecting platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: defaultTitle,
    description: defaultDescription,
    images: ['/opengraph-image'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>

      {process.env.NEXT_PUBLIC_GA_ID ? (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      ) : null}
    </html>
  )
}
