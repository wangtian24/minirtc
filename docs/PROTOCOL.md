# MiniRTC — Signaling Protocol Contract

This is the shared contract between frontend and backend. Both sides must implement against this spec.

## Transport

- WebSocket connection to `ws://<host>:<port>/ws/<room_id>`
- Room ID is a UUID4 string (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- All messages are JSON-encoded strings

## Message Format

Every message has a `type` field. Additional fields depend on type.

```json
{ "type": "<message_type>", ...payload }
```

## Client → Server Messages

### `join`
Sent immediately after WebSocket connects. Registers the client in the room.
```json
{ "type": "join" }
```

### `offer`
SDP offer to be relayed to the other peer.
```json
{ "type": "offer", "sdp": "<sdp_string>" }
```

### `answer`
SDP answer to be relayed to the other peer.
```json
{ "type": "answer", "sdp": "<sdp_string>" }
```

### `ice_candidate`
ICE candidate to be relayed to the other peer.
```json
{ "type": "ice_candidate", "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 } }
```

## Server → Client Messages

### `peer_joined`
The other peer has joined the room. Sent to both clients when the room reaches 2 participants. The `initiator` field tells the client whether it should create the SDP offer.
- `"initiator": true` → you are the first joiner — create and send the offer
- `"initiator": false` → you are the second joiner — wait for the offer
```json
{ "type": "peer_joined", "initiator": true }
{ "type": "peer_joined", "initiator": false }
```

### `peer_left`
The other peer has disconnected.
```json
{ "type": "peer_left" }
```

### `offer`
Relayed SDP offer from the other peer.
```json
{ "type": "offer", "sdp": "<sdp_string>" }
```

### `answer`
Relayed SDP answer from the other peer.
```json
{ "type": "answer", "sdp": "<sdp_string>" }
```

### `ice_candidate`
Relayed ICE candidate from the other peer.
```json
{ "type": "ice_candidate", "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 } }
```

### `room_full`
Room already has 2 participants. Connection will be closed by server after sending this.
```json
{ "type": "room_full" }
```

### `error`
Generic error.
```json
{ "type": "error", "message": "<description>" }
```

## Connection Lifecycle

```
Client connects to ws://<host>:<port>/ws/<room_id>
  │
  ├─ Server validates room_id is valid UUID4
  │   └─ If invalid → send { "type": "error", "message": "invalid room id" }, close
  │
  ├─ Server checks room occupancy
  │   └─ If room has 2 people → send { "type": "room_full" }, close
  │
  ├─ Server adds client to room
  │
  ├─ If room now has 2 people:
  │   └─ Send { "type": "peer_joined", "initiator": true } to the FIRST joiner
  │   └─ Send { "type": "peer_joined", "initiator": false } to the SECOND joiner
  │
  ├─ Signaling exchange (offer → answer → ice_candidates)
  │   └─ Server blindly relays these to the other peer in the room
  │
  └─ On disconnect:
      ├─ Server removes client from room
      ├─ Send { "type": "peer_left" } to remaining peer
      └─ If room is empty → delete room
```

## Who Offers?

Determined by the `initiator` field in `peer_joined`. The server sends `"initiator": true` to the first joiner and `"initiator": false` to the second joiner. The initiator creates the SDP offer. This avoids glare (both sides offering simultaneously).

## Room ID Generation

Room IDs are UUID4. The frontend generates them client-side when creating a new room. The backend validates the format (rejects non-UUID strings) but does not generate room IDs itself.

## Ports / Endpoints

- **Backend WebSocket:** `ws://localhost:8765/ws/<room_id>`
- **Backend static files (optional):** `http://localhost:8765/` — serves frontend files, but frontend can also be served separately during development
