# MiniRTC — Backend Design Doc

## Overview

Async Python WebSocket server that handles room management, presence, and signaling relay for 1:1 WebRTC calls.

**Read [PROTOCOL.md](./PROTOCOL.md) first** — it defines the message contract between FE and BE.

## Tech Stack

- Python 3.11+
- `websockets` library (async, minimal)
- `asyncio` for event loop
- `uuid` stdlib for validation
- No framework, no database

## File Structure

```
server.py              # Entry point — all server logic
requirements.txt       # websockets
static/                # Frontend files (served by the server)
```

## Core Data Structure

```python
# room_id (str) → set of WebSocket connections
rooms: dict[str, set[WebSocket]] = {}
```

No user IDs, no auth tokens, no persistence. A "user" is just a WebSocket connection.

## Server Responsibilities

### 1. WebSocket Endpoint

Route: `ws://localhost:8765/ws/<room_id>`

On new connection:
1. Extract `room_id` from URL path
2. Validate it's a valid UUID4 format → reject with error if not
3. Check room occupancy → reject with `room_full` if already 2
4. Add socket to `rooms[room_id]`
5. If room now has 2 sockets → send `peer_joined` with `"initiator": true` to the first joiner, `"initiator": false` to the second joiner
6. Enter message loop: receive messages, relay to the other socket in the room
7. On disconnect → remove from room, send `peer_left` to remaining peer, delete room if empty

### 2. Message Relay

For `offer`, `answer`, and `ice_candidate` messages: find the *other* socket in the same room and forward the message as-is. No parsing or transformation needed — the server is a dumb relay for signaling messages.

### 3. Static File Serving

Serve files from `./static/` directory over HTTP on the same port. This is a nice-to-have for single-process deployment but not critical — FE can be served separately.

Implementation: use `websockets`' built-in HTTP handling or add a simple handler that reads files from disk.

### 4. Room Cleanup

- When a socket disconnects, remove it from the room
- If the room is empty, delete it from the `rooms` dict
- No timeouts or heartbeats for MVP

## Error Handling

| Scenario | Response |
|----------|----------|
| Invalid UUID room ID | `{ "type": "error", "message": "invalid room id" }` → close |
| Room full (2 people) | `{ "type": "room_full" }` → close |
| Unknown message type | Ignore silently (don't crash) |
| Relay target disconnected | Send `peer_left` to remaining peer |
| Malformed JSON | Ignore silently |

## Configuration

Hardcoded defaults, overridable via environment variables:

```
HOST = 0.0.0.0
PORT = 8765
STATIC_DIR = ./static
```

## Testing Without Frontend

Use `websocat` or a simple Python script to test:

```bash
# Terminal 1: start server
python server.py

# Terminal 2: join as peer A
websocat ws://localhost:8765/ws/550e8400-e29b-41d4-a716-446655440000
{"type": "join"}

# Terminal 3: join as peer B
websocat ws://localhost:8765/ws/550e8400-e29b-41d4-a716-446655440000
{"type": "join"}

# Both should receive: {"type": "peer_joined"}
```

## Implementation Notes

- Use `websockets.serve()` with a handler coroutine — one coroutine per connection
- `asyncio.run()` as entry point
- Helper function `get_other_peer(room_id, ws)` → returns the other socket or None
- Total code estimate: ~80-120 lines
