import Script from 'next/script';
import { publicEnv } from '@/lib/env';

/** GA / Yandex Metrica, when configured. Rendered by both root layouts. */
export function AnalyticsScripts() {
  return (
    <>
      {publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${publicEnv.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}');
              window.gtag = gtag;`}
          </Script>
        </>
      )}

      {publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID && (
        <Script id="ym-init" strategy="afterInteractive">
          {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
            m[i].l=1*new Date();
            k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
            (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
            ym(${publicEnv.NEXT_PUBLIC_YANDEX_METRICA_ID}, "init", { defer: true });
            window.ym = ym;`}
        </Script>
      )}
    </>
  );
}
