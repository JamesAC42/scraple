import "../styles/globals.scss";
import localFont from "next/font/local";
import ThemeWrapper from "../components/ThemeWrapper";
import { PopupProvider } from "../contexts/PopupContext";
import PopupContainer from "../components/PopupContainer";
// Import Manrope font
const manrope = localFont({
  src: "../../public/fonts/Manrope/Manrope.ttf",
  display: "swap",
  variable: "--font-manrope",
});

export const metadata = {
  title: "Scraple - Free Word Connection Game",
  description: "Scraple is a free word game combining elements of Scrabble and Wordle. Challenge your vocabulary, form words on a board, and earn points in this addictive word puzzle game.",
  keywords: "word game, free word game, scrabble, wordle, word puzzle, vocabulary game, letter tiles, word connection",
  openGraph: {
    title: "Scraple - Free Word Connection Game",
    description: "Challenge your vocabulary with Scraple, a free word game combining elements of Scrabble and Wordle. Form words, earn points, and have fun!",
    type: "website",
    locale: "en_US",
    url: "https://scraple.io",
    siteName: "Scraple",
    images: [
      {
        url: "https://scraple.io/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "Scraple - Free Word Connection Game",
      }
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scraple - Free Word Connection Game",
    description: "Challenge your vocabulary with Scraple, a free word game combining elements of Scrabble and Wordle.",
    images: ["https://scraple.io/images/og-image.png"],
    creator: "@scraple_game",
    site: "@scraple_game",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon.png" />
      </head>
      <body className={manrope.className}>
        <PopupProvider>
          <script defer src="https://umami.ovel.sh/script.js" data-website-id="f4100034-0a28-434a-bd76-cd2ac77d5b39"></script>
          <ThemeWrapper>
            {children}
            <PopupContainer />
          </ThemeWrapper>
        </PopupProvider>
      </body>
    </html>
  );
}
