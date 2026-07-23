# YouTube Danmaku Player

A client-side web app that plays a YouTube video and overlays its timestamped
comments on the video at the moment they reference, danmaku style. Paste a
link, watch, read the crowd react in real time.

Everything runs in your browser. You bring your own YouTube API key; it is
stored in the browser's localStorage and sent only to Google's API. No server,
no build step, no accounts.

Not affiliated with YouTube / Google.

## Get an API key

The app needs a (free) YouTube Data API v3 key. Takes about 3 minutes:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Create a project (any name).
3. Open **APIs & Services > Library**, search "YouTube Data API v3", click **Enable**.
4. Open **APIs & Services > Credentials**, click **Create credentials > API key**.
5. Recommended: click the key to edit it, and under **API restrictions** limit it
   to the YouTube Data API v3 only. If you set a website restriction, use the
   domain where this app is hosted.

The key has a free daily quota of 10,000 units. Loading a video's comments costs
about 1 unit per 100 comments, so even heavy use rarely dents it. If you do run
out, it resets at midnight Pacific.

## Use it

Hosted at [yt.remls.io](https://yt.remls.io) (bring your own key).

To run it locally instead, serve `viewer/` over HTTP (the app is ES modules,
so `file://` won't work):

```bash
cd viewer
python3 -m http.server 8777
# open http://localhost:8777/
```

Or deploy the repo to any static host. A `netlify.toml` is included
(publishes `viewer/`, stamps the service worker cache version per deploy).

First run: paste your API key, paste a YouTube link, hit Watch. The key is
remembered per browser; change or clear it in Settings.

## Views

| Mode | What it is |
|------|------------|
| **Default** | Video on top, full comment browser below: search, sort by posted time (newest/oldest), filter to timestamped only |
| **Theater** | Video as large as the screen allows, comment panel on the right |
| **Fullscreen** | Video fills the screen next to the same comment panel, collapsible to give the video the full width |

The theater/fullscreen panel sorts by posted time, or, with the **Timed only**
filter on, switches to video-time order and follows playback: the comment for
the moment you're watching stays pinned to the top, older moments below.
Scrolling by hand pauses the follow; **Jump to live** resumes it.

Timestamps inside comment text are tappable and seek the video. Replies are
marked with a &#8627; icon. The chat icon in the top bar toggles the danmaku
overlay without touching anything else; the top bar also switches between
default and theater view and enters fullscreen.

Keyboard shortcuts match YouTube: space or `k` play/pause, arrows seek 5s,
`j`/`l` seek 10s, up/down volume, `m` mute, `f` fullscreen, `0`-`9` jump to
a tenth of the video.

## Settings

Overlay: style (scroll or popup), popup corner (top or bottom, left, center,
or right), scroll speed, font size, opacity, lane
coverage, max on screen, max length before truncation. Comments: fetch all
replies (the API inlines up to 5 per thread; this fetches the rest, slower on
big videos), clear cached comment data. API key: view masked, change, clear.
All stored locally.

## Notes

- Comments load fully before playback starts; a counter shows progress.
- Loaded comments are cached on the device (IndexedDB), so revisiting or
  reloading a video costs no API quota. The **Reload** button above either
  comment list fetches fresh, after a confirming second click.
- Playback position is remembered per video; reopening resumes where you
  left off (finished videos start over). The link button in the top bar
  copies a shareable app URL, with or without the current position
  (`?v=ID&t=seconds` links seek on load). On Netlify, an edge function adds
  the video's title and thumbnail as OG tags to shared links.
- A comment's first timestamp decides when it fires in the overlay. Timestamps
  past the video's duration are ignored (so "10:30 PM" in a 5-minute video
  doesn't fire).
- Videos with comments turned off still play, with a notice instead of the list.
- Installable as a PWA. Offline it can only show the shell; playback and
  comments need YouTube.
- Installed on Android, the app appears in the system share sheet: share a
  YouTube link from any app and it opens here.

## Layout

```
viewer/          the app (publish this directory)
  index.html
  styles.css
  sw.js          service worker
  app/
    core/        util, state, comment cache, YouTube API
    ui/          landing, settings
    views/       player, comment lists, danmaku engine
```
