import localFont from "next/font/local";
import "./globals.css";

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata = {
  title: "Minimum Context Finder",
  description: "Find the minimal set of files relevant to any task in a GitHub repo",
  metadataBase: new URL("https://mincontext.dev"),
  openGraph: {
    title: "Minimum Context Finder",
    description: "Find the minimal set of files relevant to any task in a GitHub repo",
    url: "https://mincontext.dev",
    siteName: "mincontext.dev",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}