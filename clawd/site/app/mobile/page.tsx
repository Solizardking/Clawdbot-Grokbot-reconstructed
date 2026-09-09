import {ArrowDown,ArrowUpRight,Smartphone,ShieldCheck,Wallet,ChartCandlestick} from 'lucide-react';
import {Downloads} from '@/components/downloads';
import {mobileLanding,MOBILE_PUBLIC_PATHS} from '@/lib/mobile-landing';
import {ANDROID_PACKAGE} from '@/lib/android-association';
export const dynamic='force-dynamic';
export const metadata={title:'Clawd for Solana Mobile',description:'Native Android beta for wallet sign-in, hosted AI conversations, and exact-mint SOL/CLAWD market research.'};
const icons=[Wallet,ShieldCheck,ChartCandlestick];
export default function Mobile(){
  return <>
    <header className="site-nav"><a href="/mobile" className="brand"><span className="brand-mark">c</span>clawd<span className="brand-divider"/>MOBILE</a><nav aria-label="Main navigation"><a href="#install">Install</a><a href="#android">Android</a><a href="/privacy">Privacy</a><a href="/">Desktop</a></nav></header>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot"/>{mobileLanding.eyebrow}</div>
          <h1>Solana Mobile.<br/>Android beta.<br/><span>Clawd.</span></h1>
          <p>{mobileLanding.summary}</p>
          <div className="hero-actions"><a className="button primary" href="#install">Get the Android APK <ArrowDown size={16}/></a><a className="text-button" href="/privacy">{mobileLanding.privacyLabel} <ArrowUpRight size={15}/></a></div>
          <div className="hero-footnote"><Smartphone size={13}/> Native Android · Mobile Wallet Adapter · Not Expo Go</div>
        </div>
        <div className="desk-preview" aria-label="Clawd for Solana Mobile">
          <div className="window-bar"><span/><span/><span/><div>CLAWD / SOLANA MOBILE</div><span className="preview-label">ANDROID</span></div>
          <div className="preview-body">
            <aside>
              <div className="desk-name"><span className="brand-mark">c</span>clawd</div>
              <p>Desk</p><p>Chat</p><p>Account</p>
              <div className="sidebar-bottom">SOLANA MOBILE<br/>ANDROID BETA</div>
            </aside>
            <div className="preview-content">
              <div className="preview-prompt">Use installed wallet.<br/>Load the exact CLAWD mint.</div>
              <div className="preview-step"><span>01</span><div><strong>Sign In With Solana</strong><p>MWA wallet. Seven-day revocable session.</p></div><Wallet size={15}/></div>
              <div className="preview-step"><span>02</span><div><strong>Hosted access code</strong><p>Separate from wallet identity. Keys stay on Fly.</p></div><ShieldCheck size={15}/></div>
              <div className="preview-step"><span>03</span><div><strong>Exact-mint Desk</strong><p>SOL and CLAWD snapshots with source times.</p></div><ChartCandlestick size={15}/></div>
              <div className="preview-composer">{mobileLanding.noTrades}</div>
            </div>
          </div>
          <div className="window-footer"><span className="status-dot"/>PACKAGE {ANDROID_PACKAGE}<span>VERSION {mobileLanding.version}</span></div>
        </div>
      </section>
      <section className="workspace-section" id="android">
        <div className="section-heading">
          <span className="eyebrow">CLAWD FOR SOLANA MOBILE</span>
          <h2>Wallet sign-in, hosted chat, live research.</h2>
          <p>{mobileLanding.expoGo}</p>
        </div>
        <div className="feature-grid">{mobileLanding.features.map((feature,index)=>{const Icon=icons[index]!;return <article className="feature" key={feature.title}><Icon size={21}/><h3>{feature.title}</h3><p>{feature.text}</p></article>;})}</div>
      </section>
      <section className="access-section" id="install">
        <div>
          <span className="eyebrow">INSTALL PATH</span>
          <h2>Sideload the signed arm64 APK.</h2>
          <p>{mobileLanding.install} Public URLs for this page: {MOBILE_PUBLIC_PATHS.join(' and ')}.</p>
          <p>{mobileLanding.expoGo}</p>
          <a className="button primary" href="#download-android">Android package {mobileLanding.apkName}</a>
        </div>
        <div className="access-ledger">
          <div><span>PACKAGE</span><strong>{ANDROID_PACKAGE}</strong></div>
          <div><span>VERSION CODE</span><strong>{mobileLanding.versionCode}</strong></div>
          <div><span>ARCHITECTURE</span><strong>{mobileLanding.architecture}</strong></div>
          <p>{mobileLanding.noTrades}</p>
        </div>
      </section>
      <section className="download-section" id="download-android">
        <div className="section-heading">
          <span className="eyebrow">ANDROID BETA</span>
          <h2>Signed release when published.</h2>
          <p>When an Android row is published, it appears below with checksum and signing status. Until then, install the operator-signed {mobileLanding.apkName} produced by the Solana Mobile release script. Expo Go is not a supported install path.</p>
        </div>
        <Downloads/>
      </section>
    </main>
    <footer>
      <a className="brand" href="/mobile"><span className="brand-mark">c</span>clawd</a>
      <p>Clawd for Solana Mobile.</p>
      <a href={mobileLanding.privacyHref}>{mobileLanding.privacyLabel} <ArrowUpRight size={13}/></a>
      <a href={mobileLanding.desktopHref}>Desktop</a>
    </footer>
  </>;
}
