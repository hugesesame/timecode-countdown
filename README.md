# TC-CD (Timecode Countdown)

English | [日本語](README.ja.md)

TC-CD is a web app that follows timecode, counts down to each cue, and shows the moment to press GO, so that gear with no timecode input can still be run by hand, on time.

It runs in the browser on a PC. There is nothing to install, and once you have opened it, it works without an internet connection.

**Open the app: https://hugesesame.github.io/timecode-countdown/** (Chrome or Edge on a PC)

> **Beta.** TC-CD is still being tested and has not been used on a real show. MTC, LTC and MIDI output have been checked only with a few software sources. Test it with your own gear before relying on it.

![TC-CD in Show mode: the countdown, the lane and the cue list](screenshots/show-mode.png)

## What it does

- **Countdown** to the next cue. The color changes from yellow to orange to red as GO approaches, and flashes green at GO.
- **Lane**: a bar under the countdown where cue markers travel toward the GO line at a steady speed, so you can see cues that follow closely.
- **Cue List** with pages. Each cue has a number, trigger time, name and info. Pages keep running while they are in the background.
- **Timecode sources**
  - Gen: a built-in generator, for programming and rehearsal. It can be started and stopped with MIDI notes
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

## Getting started

1. On a PC, open **https://hugesesame.github.io/timecode-countdown/** in Chrome or Edge.
2. That is all. There is nothing to install and no account to make.

Add a bookmark so you can open it again later.

### What the browser asks you

The browser asks for permission the first time you use some features. Choose **Allow** each time. If you choose Block by mistake, click the icon at the left of the address bar and change the setting there.

| When | What the browser asks | Why |
|---|---|---|
| You press **Enable** under MIDI | To control MIDI devices | To receive MTC and send MIDI Notes |
| You choose **LTC** as the source | To use the microphone | To read timecode from the audio input. Nothing is recorded |
| You press **Display** | To allow pop-ups (only if the window was blocked) | To open the display window |

The click needs one more step: the browser does not let a page make sound until you have clicked somewhere on it. If the Click button shows **⚠ Click**, click the button or anywhere on the page.

### Where your show is kept

- Your show is saved as you work, in the browser on that PC. There is no Save button.
- It is not sent anywhere. A different PC, or a different browser on the same PC, does not have it.
- Clearing the browser's site data removes it.
- Press **Export** to save the show as a file. Do this to keep a backup, and to move the show to another PC with **Import**.

### Without an internet connection

- Once the app is open, it keeps working if the connection drops. Timecode, MIDI, the click and the display window do not use the internet.
- The app also keeps a copy of itself in the browser. When the bottom of the side panel shows **Offline ready** (in Program mode), you can reload or reopen the page on that PC without a connection.
- So open the app once where you have a connection, and check for **Offline ready**, before you take the PC to a place without one.
- When there is a connection, the app loads the newest version each time you open it.

### Try it with the demo show

[`samples/demo-show.json`](samples/demo-show.json) is a sample show: three pages and 20 cues of stage effects for an imaginary concert. Open that link and press the download button at the top right of the file to save it to your PC.

1. Press **Import** and choose the `demo-show.json` you saved. This replaces the current show, so export it first if you need it.
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

Each cue has two switches at the right of the list:

- **On / Off** turns the whole cue off. It does not fire and is left out of the countdown.
- **MIDI** turns off only the MIDI Note. The countdown, the lane and the click stay the same, so you can count down to something you operate by hand on other gear. The GO button and the space bar do not send the Note either.

If timecode jumps forward, the cues it jumped over do not fire. If it goes back, the cues after that position become active again.

### Controlling Gen with MIDI notes

You can start and stop Gen from a MIDI keyboard, a pad or a foot switch.

1. Press **Enable** under MIDI and choose the device under **MIDI In**.
2. Under **Gen remote**, press **Learn** next to Play, then play the note you want to use. Do the same for Stop and Rewind.
3. Press **×** to remove a note.

Play starts from the current position, Stop stops there, and Rewind returns to `00:00:00:00`. The notes work only while the source is Gen. They are saved in the browser on that PC, not in the show file.

### Countdown

- Click the countdown number to switch between whole seconds and tenths of a second. Whole seconds are rounded up, so the moment the number reaches 0 is GO. The display window follows the same setting.
- The seconds at which the color changes are set under **COUNTDOWN** in the side panel: Standby (yellow), Warn (orange) and Final (red). The lane shows the Standby time from end to end.
- The **Stby** column sets a different Standby time for one cue.

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

This part is for people who want to change the app or build it themselves. You do not need it to use the app. It needs Node.js.

```
npm install
npm run dev
```

Open the address that appears in the terminal (normally http://localhost:5173/).

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the tests |
| `npm run build` | Type-check and build `dist/index.html` |

`npm run build` puts the whole app into one file, `dist/index.html`. You can copy that file to any PC and open it in Chrome or Edge without a server.

The three ways to open the app behave a little differently:

| | Public site | Dev server (localhost) | `dist/index.html` opened directly |
|---|---|---|---|
| What you need | A browser | Node.js | A browser and the file |
| Internet | Needed the first time | Not needed | Not needed |
| Choosing audio devices (LTC input, click output) | Yes | Yes | System default only |
| Saved show | Kept for the site | Kept for localhost | Kept apart from both |

Each one keeps its saved show apart from the others. Use Export and Import to move a show between them.

| Path | Contents |
|---|---|
| `src/core/` | Timecode math, cue firing, MTC and LTC decoding, and their tests |
| `src/io/` | Web MIDI, LTC audio input, click sound |
| `src/ui/` | Header, cue list, side panel, display window |
| `src/app.ts` | App state and actions |

Built with TypeScript, Vite and Vitest. There are no runtime dependencies.

## License

[MIT](LICENSE). You are free to use, change and share TC-CD, including at work. It comes with no warranty.
