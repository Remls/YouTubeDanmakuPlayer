/* Injects per-video Open Graph tags into the app HTML when the request has
   ?v=<id>, so shared links unfurl with the video's title and thumbnail.
   Uses YouTube's keyless oEmbed endpoint; no user API key is involved.
   Any failure falls through to the static page unchanged. */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const esc = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('"', '&quot;');

export default async (request, context) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('v') || '';
  if (!ID_RE.test(id)) return context.next();

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  let meta;
  try {
    const r = await fetch(
      'https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id) + '&format=json',
    );
    if (!r.ok) return response;
    meta = await r.json();
  } catch {
    return response;
  }

  const t = parseInt(url.searchParams.get('t') || '', 10);
  const share = url.origin + url.pathname + '?v=' + id + (t > 0 ? '&t=' + t : '');
  const tags = [
    `<meta property="og:type" content="video.other">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="Watch with the comments overlaid, danmaku style. Video by ${esc(meta.author_name)}.">`,
    `<meta property="og:image" content="${esc(meta.thumbnail_url)}">`,
    `<meta property="og:url" content="${esc(share)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html.replace('</head>', tags + '\n</head>'), {
    status: response.status,
    headers,
  });
};

export const config = { path: ['/', '/index.html'], onError: 'bypass' };
