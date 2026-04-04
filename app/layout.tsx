import './globals.css'
import { GoogleAnalytics } from '@next/third-parties/google'

export const metadata = {
  title: 'ALPA',
  description: 'Autonomous Lead Engine',
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
