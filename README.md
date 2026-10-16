# Pageturn – PDF reader (offline-capable)

| File | What it does |
|---|---|
| index.html | The page skeleton: toolbar, library screen, reader screen. |
| style.css | All colours and layout (black/green theme, mobile rules). |
| app.js | All behaviour: opening PDFs, drawing pages, bookmarks, highlights, saving your place. |
| sw.js | Service worker: caches the files so the app works offline. |
| manifest.json | Lets you install it on your phone's home screen (name, colours, icons). |
| pdf.min.js, pdf.worker.min.js | Mozilla's pdf.js library (not our code): reads and draws PDFs. |
| icon-192.png, icon-512.png | App icons. |

How it works: you choose a PDF; it is stored in the browser's IndexedDB together with your page number, bookmarks and highlights. Each page is drawn on a canvas, with an invisible text layer on top so text can be selected and turned into highlights.

To publish: upload this folder to any static host (e.g. Netlify Drop), open it once online, then Add to Home Screen.
