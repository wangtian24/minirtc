# MiniRTC

Peer-to-peer video calling in the browser. No accounts, no installs, no bloat.

Create a room, share the link, start talking.

```
Browser A ←──WebRTC (P2P media)──→ Browser B
    ↕                                    ↕
    └──WebSocket──→ Python Server ←──WebSocket──┘
                   (signaling only)
```

## Features

- **1:1 video & audio calls** — direct peer-to-peer via WebRTC
- **Zero friction** — click "Create Room", share the link, done
- **Privacy-first** — media flows directly between browsers; the server only relays signaling
- **Camera & mic controls** — mute, disable camera, leave call
- **Audio-only fallback** — works even if camera access is denied
- **No frameworks** — vanilla JS frontend, single-file Python backend
- **Single process** — one server handles both signaling and static files

## Quick Start

```bash
# Clone and install
git clone https://github.com/wangtian24/minirtc.git
cd minirtc
pip install -r requirements.txt

# Run
python server.py
```

Open [http://localhost:8765](http://localhost:8765), create a room, and share the URL with someone.

## How It Works

1. **User A** clicks "Create Room" — generates a unique room URL
2. **User B** opens the shared link
3. The server pairs them and tells User A to initiate the connection
4. User A sends an SDP offer → server relays it → User B responds with an SDP answer
5. Both exchange ICE candidates for NAT traversal
6. WebRTC peer connection established — **media flows directly between browsers**
7. The server is no longer in the media path

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, `websockets`, `asyncio` |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Media | WebRTC (`RTCPeerConnection`, `getUserMedia`) |
| NAT Traversal | Google STUN servers |

## Configuration

Environment variables (all optional):

```bash
HOST=0.0.0.0        # Bind address (default: 0.0.0.0)
PORT=8765            # Server port (default: 8765)
STATIC_DIR=./static  # Static files directory (default: ./static)
```

## Project Structure

```
minirtc/
├── server.py          # WebSocket signaling server + static file serving
├── static/
│   ├── index.html     # Single-page UI (landing + room views)
│   ├── app.js         # WebRTC + signaling logic
│   └── style.css      # Styling
├── DESIGN.md          # Detailed design document
└── requirements.txt   # Python dependencies
```

## Design Decisions

- **Dumb relay** — the server forwards signaling messages as-is without parsing them, keeping it simple and protocol-agnostic
- **Server-assigned roles** — the server tells each peer whether they're the initiator, avoiding the WebRTC "glare" problem
- **Hash routing** — room ID lives in the URL hash (`/#room-id`), so the server always serves the same HTML
- **In-memory state** — rooms exist only while occupied; no database needed

## Limitations

This is an MVP. Intentionally not included:

- Authentication / user accounts
- Text chat
- Call recording
- Group calls (>2 participants)
- TURN relay (needed for restrictive NATs/firewalls)
- Persistent state / database

## License

MIT
