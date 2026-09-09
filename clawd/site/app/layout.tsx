import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Clawd — Your Solana desktop',description:'A native desktop for Solana research, AI agents, crypto charts, and wallet-approved workflows.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
