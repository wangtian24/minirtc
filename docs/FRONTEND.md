# MiniRTC — Frontend Design Doc

## Overview

Vanilla JS single-page app that connects to the signaling server via WebSocket and establishes a WebRTC peer-to-peer audio/video call.

**Read [PROTOCOL.md](./PROTOCOL.md) first** — it defines the message contract between FE and BE.

## Tech Stack

- Vanilla HTML/CSS/JS — no framework, no build step
- Browser WebRTC APIs (`RTCPeerConnection`, `getUserMedia`)
- Native WebSocket API

## File Structure

```
static/
├── index.html     # Single page with room creation + call UI
├── app.js         # All logic: signaling, WebRTC, UI state
└── style.css      # Minimal styling
```

## URL Scheme

- `/` — Landing page. Shows "Create Room" button.
- `/#<room_id>` — Room page. Auto-connects to signaling server for that room.

Use hash-based routing so the static server doesn't need to handle routes — any URL serves `index.html`, JS reads the hash.

## UI States & Elements

### Landing State (no room ID in hash)
- "Create Room" button → generates UUID4 client-side, sets `location.hash`, transitions to room state

### Room State (room ID present in hash)
- **Room URL display** — copyable link to share
- **Status indicator** — "Waiting for peer..." / "Connected" / "Disconnected" / "Room full"
- **Local video** — small, corner (self-view)
- **Remote video** — large, center
- **Controls:**
  - Join/Leave call button
  - Mute/Unmute mic toggle
  - Camera on/off toggle

### State Machine

```
IDLE → (hash has room_id) → WAITING_FOR_PEER
WAITING_FOR_PEER → (peer_joined received) → CONNECTING
CONNECTING → (WebRTC connected) → IN_CALL
IN_CALL → (peer_left / user leaves) → IDLE or WAITING_FOR_PEER
ERROR → (room_full / connection failure)
```

## WebRTC Flow

### When You Are the First Joiner (offerer)

1. Connect WebSocket to `ws://<host>/ws/<room_id>`
2. Send `{ "type": "join" }`
3. Wait for `peer_joined` message
4. On `peer_joined`:
   - Create `RTCPeerConnection` with STUN config
   - Call `getUserMedia()` for local audio/video
   - Add local tracks to peer connection
   - Create SDP offer → `setLocalDescription(offer)`
   - Send `{ "type": "offer", "sdp": offer.sdp }` via WebSocket
5. Receive `answer` → `setRemoteDescription(answer)`
6. Exchange ICE candidates as they trickle in

### When You Are the Second Joiner (answerer)

1. Connect WebSocket to `ws://<host>/ws/<room_id>`
2. Send `{ "type": "join" }`
3. Receive `peer_joined` — but you are the second joiner, so wait for the offer
4. Receive `offer`:
   - Create `RTCPeerConnection` with STUN config
   - `setRemoteDescription(offer)`
   - Call `getUserMedia()` for local audio/video
   - Add local tracks to peer connection
   - Create SDP answer → `setLocalDescription(answer)`
   - Send `{ "type": "answer", "sdp": answer.sdp }` via WebSocket
5. Exchange ICE candidates

### How to Know If You're First or Second?

The server tells you. The `peer_joined` message includes an `"initiator"` field:
- `"initiator": true` → you are the first joiner — create and send the SDP offer
- `"initiator": false` → you are the second joiner — wait for the offer

No local tracking needed.

## RTCPeerConnection Config

```javascript
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};
```

## ICE Candidate Handling

```javascript
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    ws.send(JSON.stringify({
      type: "ice_candidate",
      candidate: event.candidate.toJSON()
    }));
  }
};
```

On receiving `ice_candidate` from signaling:
```javascript
peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
```

## Media Handling

```javascript
// Get local media
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true  // or false for audio-only
});

// Display local video
localVideo.srcObject = stream;

// Add tracks to peer connection
stream.getTracks().forEach(track => {
  peerConnection.addTrack(track, stream);
});

// Receive remote tracks
peerConnection.ontrack = (event) => {
  remoteVideo.srcObject = event.streams[0];
};
```

## Mute/Unmute & Camera Toggle

Toggle `track.enabled` — this keeps the track in the connection but sends silence/black:

```javascript
// Mute
localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);

// Camera toggle
localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
```

## Error Handling

| Scenario | UI Response |
|----------|-------------|
| `room_full` message | Show "Room is full" status, disable controls |
| WebSocket disconnect | Show "Disconnected", attempt reconnect after 2s |
| `getUserMedia` denied | Show "Microphone/camera access required" |
| Peer connection failed | Show "Connection failed", offer retry |
| `peer_left` message | Clean up remote video, reset to waiting state |

## Development Without Backend

For UI development without a running backend, you can:
1. Mock the WebSocket connection with a simple class that echoes messages
2. Use `getUserMedia` locally to test video/audio display
3. Create a loopback test (connect local peer connection to itself)

## UUID Generation (Client-Side)

```javascript
function generateRoomId() {
  return crypto.randomUUID();  // built into modern browsers
}
```
