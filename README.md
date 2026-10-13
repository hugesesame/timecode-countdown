<!-- Draft. To add later: license -->

# TC-CD (Timecode Countdown)

English | [日本語](README.ja.md)

TC-CD is a web app that follows timecode, counts down to each cue, and shows the moment to press GO, so that gear with no timecode input can still be run by hand, on time.

It runs in the browser on a PC, builds into a single HTML file, and works without an internet connection.

**Open the app: https://hugesesame.github.io/timecode-countdown/** (Chrome or Edge on a PC)

> **Beta.** TC-CD is still being tested and has not been used on a real show. MTC, LTC and MIDI output have been checked only with a few software sources. Test it with your own gear before relying on it.

![TC-CD in Show mode: the countdown, the lane and the cue list](screenshots/show-mode.png)

## What it does

- **Countdown** to the next cue. The color changes from yellow to orange to red as GO approaches, and flashes green at GO.
- **Lane**: a bar under the countdown where cue markers travel toward the GO line at a steady speed, so you can see cues that follow closely.
- **Cue List** with pages. Each cue has a number, trigger time, name and info. Pages keep running while they are in the background.
- **Timecode sources**
  - Gen: a built-in generator, for programming and rehearsal
  - MTC: MIDI Timecode from a MIDI input
  - LTC: timecode decoded from an audio input
- **MIDI Note output** when a cue fires, with channel, note and velocity per cue.
- **Click**: a click at 3, 2 and 1 seconds before a cue, and a higher tone at GO.
- **Display window** for a second screen, showing only the next cue, the countdown and the lane.
- **Program / Show modes**. Show mode enlarges the display and locks editing.
- **Show files**: the show is saved in the browser as you work, and can be exported to and imported from a JSON file.

Frame rates: 24, 25, 29.97 drop-frame and 30 fps.

## Requirements

- A PC with **Chrome or Edge**. The app uses the Web MIDI API, and choosing the audio output for the click also needs these browsers.
- The layout is made for PC screens. Phones and tablets are not supported.
- Node.js, only if you build the app yourself.

## Getting started

```
npm install
npm run dev
```

Open the address that appears in the terminal (normally http://localhost:5173/).

To make the single-file version:

```
npm run build
```

This writes `dist/index.html`. Copy that one file to any PC and open it in Chrome or Edge. No server or network is needed.

| | Dev server (localhost) | `dist/index.html` opened directly |
|---|---|---|
| Server | Needed | Not needed |
| Choosing audio devices (LTC input, click output) | Yes | System default only |
| Saved show | Kept per address | Kept separately from localhost |

The two keep their saved shows apart. Use Export and Import to move a show between them.

### Try it with the demo show

`samples/demo-show.json` is a sample show: three pages and 20 cues of stage effects for an imaginary concert.

1. Press **Import** and choose `samples/demo-show.json`. This replaces the current show, so export it first if you need it.
2. Set the timecode source to **Gen**.
3. Press play, or click the timecode display, type `00001900` and press Enter to jump to `00:00:19:00`, where three cues come close together.

## Using it

![Program mode: editing the cue list, with the MIDI and countdown settings on the right](screenshots/program-mode.jpg)

1. Add cues with **+ Add Cue** and type a trigger time. Typing `1000` gives `00:00:10:00`.
2. Choose the timecode source at the top left: **Gen**, **MTC** or **LTC**.
3. For MTC or MIDI Note output, press **Enable** under MIDI and choose the ports.
4. For LTC, allow microphone access and choose the audio input and channel. Nothing is recorded.
5. Switch to **Show** mode for the show.

A cue fires when timecode passes its trigger time. You can also fire by hand with the GO button or the space bar: it fires the selected cue, or the next cue if none is selected.

If timecode jumps forward, the cues it jumped over do not fire. If it goes back, the cues after that position become active again.

### Keys

| Key | Action |
|---|---|
| Space | GO |
| ↑ / ↓ | Select a cue |
| Alt + ↑ / ↓ | Move the selected cue |
| Enter | Edit the selected cue (Tab moves to the next field) |
| C | Capture the current timecode into the selected cue |
| F | Fullscreen |
| ⌘Z / Ctrl+Z | Undo |
| Esc | Clear the selection |

### Pages

- Each page has its own cue list and a timecode offset, such as the start time of a song.
- **TC ON / TC OFF** on a page stops timecode from firing that page's cues.
- **TC ON** in the header does the same for all pages. The timecode display keeps running.

### Display window

Press **Display** in the toolbar to open a second window, then move it to the second screen. Press the button at its top right, the F key, or double-click to make it fullscreen. It follows the page shown in the main window and closes when the main window closes.

![The display window on a second screen](screenshots/display-window.png)

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the tests |
| `npm run build` | Type-check and build `dist/index.html` |

| Path | Contents |
|---|---|
| `src/core/` | Timecode math, cue firing, MTC and LTC decoding, and their tests |
| `src/io/` | Web MIDI, LTC audio input, click sound |
| `src/ui/` | Header, cue list, side panel, display window |
| `src/app.ts` | App state and actions |

Built with TypeScript, Vite and Vitest. There are no runtime dependencies.
