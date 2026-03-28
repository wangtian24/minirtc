# MiniRTC — Design Doc (v0.1)

## Overview

1:1 audio/video calling. Two users join a room by URL, exchange media peer-to-peer via WebRTC, signaling coordinated by a lightweight Python backend over WebSocket.

## Architecture

```
┌──────────┐   WebSocket   ┌──────────────┐   WebSocket   ┌──────────┐
│ Browser A │◄────────────►│ Python Server │◄────────────►│ Browser B │
└──────────┘               └──────────────┘               └──────────┘
      ▲                                                         ▲
      └──────────── WebRTC (peer-to-peer audio/video) ──────────┘
```

## Components

### 1. Signaling Server (Python)
- **Transport:** WebSocket (via `websockets` library — async, minimal, no framework needed)
- **Why WS:** Persistent bidirectional connection. Signaling requires low-latency relay of SDP offers/answers and ICE candidates between peers. HTTP polling adds latency; SSE is one-directional. WebSocket is the natural fit.
- **Responsibilities:**
  - Room creation/join (by room ID in URL)
  - Presence tracking (who's in the room, join/leave events)
  - Relay signaling messages (SDP offer/answer, ICE candidates) between the two peers
  - Enforce max 2 participants per room
- **State:** In-memory dict. No database for MVP.

### 2. Room Model
- **Room ID:** UUID4 — non-guessable by default (128-bit random)
- **Max participants:** 2
- **Lifecycle:** Created on first join, destroyed when empty
- **Data structure:**
  ```python
  rooms: dict[str, set[WebSocket]]  # room_id -> connected sockets
  ```

### 3. Frontend (Vanilla JS + HTML/CSS)
- **Pages:** Single page — room view
- **URL scheme:** `/<room_id>` — share link to invite the other person
- **UI elements:**
  - "Create Room" button (generates UUID, navigates to room URL)
  - Join/Leave call button
  - Mute/Unmute toggle
  - Camera on/off toggle
  - Connection status indicator (connecting/connected/disconnected)
  - Remote + local video elements
- **WebRTC flow:**
  1. Connect to signaling WS
  2. When 2nd user joins → initiator sends SDP offer
  3. Other peer responds with SDP answer
  4. Exchange ICE candidates
  5. Peer connection established → media flows

### 4. Signaling Protocol (JSON over WS)

Messages between client ↔ server:

| Type | Direction | Purpose |
|------|-----------|---------|
| `join` | client→server | Join a room |
| `peer_joined` | server→client | Notify that the other peer arrived |
| `peer_left` | server→client | Notify that the other peer left |
| `offer` | client→server→client | SDP offer relay |
| `answer` | client→server→client | SDP answer relay |
| `ice_candidate` | client→server→client | ICE candidate relay |
| `room_full` | server→client | Reject — room already has 2 people |
| `error` | server→client | Generic error |

### 5. STUN/TURN
- Use Google's free STUN server (`stun:stun.l.google.com:19302`) for NAT traversal
- No TURN server for MVP (direct connections work for most networks; TURN is a scaling/reliability concern for later)

## Tech Stack
- **Backend:** Python 3.11+, `websockets` library, served via `asyncio`
- **Frontend:** Vanilla HTML/JS/CSS (no build step, no framework)
- **Static serving:** Python backend serves the HTML page too (single process)

## Non-Goals (for now)
- No auth/login
- No chat/messaging
- No recording
- No multi-party (>2)
- No TURN relay
- No persistence/database

## File Structure (planned)
```
minirtc/
├── server.py          # WebSocket signaling server + static file serving
├── static/
│   ├── index.html     # Room UI
│   ├── app.js         # WebRTC + signaling logic
│   └── style.css      # Minimal styling
├── DESIGN.md
└── requirements.txt   # websockets
```
