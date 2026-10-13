import { ImageResponse } from 'next/og';
import { publicEnv } from '@/lib/env';
import { loadOgFonts, loadOgPhoto, OG_PHOTO } from './assets';

// The salon's share image (05 §2): a near-black card with the monogram and wordmark, a brass
// eyebrow, the page title in Fraunces (plus an optional italic brass line) and a photo panel on
// the right inside a fine brass frame. Inline styles only: this is rendered by next/og, not the
// browser, so Tailwind and CSS variables are not available; the hex values are the palette's.

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const INK = '#faf7f2';
const MUTED = '#b5ada0';
const BRASS = '#c4a272';
const BRASS_DEEP = '#b08d57';

export interface OgCardProps {
  eyebrow: string;
  title: string;
  em?: string;
  subtitle?: string;
  photo: string | null;
}

// Longer titles step down so a service or stylist name never runs off the card.
export function titleSize(title: string): number {
  if (title.length > 34) return 58;
  if (title.length > 20) return 68;
  return 80;
}

function Monogram() {
  return (
    <svg width="56" height="56" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18.5" fill="none" stroke={BRASS_DEEP} strokeWidth="1.5" />
      <circle
        cx="20"
        cy="20"
        r="15"
        fill="none"
        stroke={BRASS_DEEP}
        strokeWidth="0.6"
        opacity="0.6"
      />
    </svg>
  );
}

export function OgCard({ eyebrow, title, em, subtitle, photo }: OgCardProps) {
  const host = publicEnv.siteUrl.replace(/^https?:\/\//, '');
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#111111',
        backgroundImage:
          'radial-gradient(circle at 0% 0%, rgba(176,141,87,0.22), rgba(17,17,17,0) 55%)',
        color: INK,
        fontFamily: 'Outfit',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: OG_SIZE.width - OG_PHOTO.width,
          padding: '60px 56px 56px 68px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', position: 'relative', width: 56, height: 56 }}>
            <Monogram />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 56,
                height: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Fraunces',
                fontStyle: 'italic',
                fontSize: 30,
                paddingBottom: 4,
              }}
            >
              S
            </div>
          </div>
          <div style={{ display: 'flex', fontFamily: 'Fraunces', fontSize: 34 }}>
            {publicEnv.appName}
            <span style={{ color: BRASS_DEEP }}>.</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              color: BRASS,
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: 5,
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Fraunces',
              fontSize: titleSize(title),
              lineHeight: 1.06,
            }}
          >
            <div style={{ display: 'flex', lineClamp: 3 }}>{title}</div>
            {em ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 6,
                  fontSize: Math.round(titleSize(title) * 0.72),
                  fontStyle: 'italic',
                  fontWeight: 500,
                  color: BRASS,
                }}
              >
                {em}
              </div>
            ) : null}
          </div>
          {subtitle ? (
            <div style={{ display: 'flex', fontSize: 26, color: MUTED, lineClamp: 2 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', width: 64, height: 3, backgroundColor: BRASS_DEEP }} />
          <div style={{ display: 'flex', fontSize: 20, color: MUTED, letterSpacing: 1 }}>
            {host}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', position: 'relative', width: OG_PHOTO.width, height: '100%' }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img>.
          <img
            src={photo}
            alt=""
            width={OG_PHOTO.width}
            height={OG_PHOTO.height}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              backgroundImage: 'linear-gradient(160deg, #2b251b, #161412)',
            }}
          />
        )}
        {/* Blends the photo into the dark card, then a fine brass frame on top. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            backgroundImage: 'linear-gradient(90deg, #111111 0%, rgba(17,17,17,0) 38%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 28,
            right: 28,
            bottom: 28,
            left: 28,
            display: 'flex',
            border: '1.5px solid rgba(196,162,114,0.55)',
            borderRadius: 18,
          }}
        />
      </div>
    </div>
  );
}

// A complete share image. `photos` are tried in order; the last is usually a studio photo.
export async function renderOgImage({
  photos,
  ...card
}: Omit<OgCardProps, 'photo'> & { photos: (string | undefined)[] }): Promise<ImageResponse> {
  const [fonts, photo] = await Promise.all([loadOgFonts(), loadOgPhoto(...photos)]);
  return new ImageResponse(<OgCard {...card} photo={photo} />, { ...OG_SIZE, fonts });
}
