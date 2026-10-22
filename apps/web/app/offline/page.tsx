import { Brand } from '@/components/ui';

export const metadata = { title: 'You’re offline' };

export default function Offline() {
  return (
    <div className="mobile">
      <header className="m-top">
        <Brand />
      </header>
      <main className="screen" id="main">
        <h1 className="title">You’re offline</h1>
        <p className="lede">PSEBC Lifts needs an internet connection to show your lifts. Please check your Wi-Fi or mobile data and try again.</p>
        <p className="lede">If you need help with a lift today, please phone the church office.</p>
        <a className="btn btn-primary block" href="/">
          Try again
        </a>
      </main>
    </div>
  );
}
