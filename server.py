"""MiniRTC signaling server — WebSocket relay for 1:1 WebRTC calls."""

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path

import websockets
from websockets.http11 import Request, Response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8765"))
STATIC_DIR = Path(os.environ.get("STATIC_DIR", "./static"))

# room_id → list of websocket connections (order matters: first joiner = initiator)
rooms: dict[str, list] = {}


def is_valid_uuid4(s: str) -> bool:
    try:
        val = uuid.UUID(s, version=4)
        return str(val) == s
    except (ValueError, AttributeError):
        return False


def get_other_peer(room_id: str, ws):
    """Return the other socket in the room, or None."""
    peers = rooms.get(room_id, [])
    for peer in peers:
        if peer is not ws:
            return peer
    return None


async def send_json(ws, data: dict):
    await ws.send(json.dumps(data))


async def handler(ws):
    # Extract room_id from path: /ws/<room_id>
    path = ws.request.path
    parts = path.strip("/").split("/")
    if len(parts) != 2 or parts[0] != "ws":
        await send_json(ws, {"type": "error", "message": "invalid room id"})
        await ws.close()
        return

    room_id = parts[1]
    log = logging.getLogger(f"room.{room_id[:8]}")

    if not is_valid_uuid4(room_id):
        log.warning("rejected connection — invalid room id: %s", room_id)
        await send_json(ws, {"type": "error", "message": "invalid room id"})
        await ws.close()
        return

    # Check room occupancy
    if room_id in rooms and len(rooms[room_id]) >= 2:
        log.warning("rejected connection — room full")
        await send_json(ws, {"type": "room_full"})
        await ws.close()
        return

    # Add to room
    if room_id not in rooms:
        rooms[room_id] = []
    rooms[room_id].append(ws)
    peer_num = len(rooms[room_id])
    log.info("peer %d joined  (remote=%s)", peer_num, ws.remote_address)

    # If room now has 2 peers, notify both
    if len(rooms[room_id]) == 2:
        log.info("room full — sending peer_joined to both peers")
        await send_json(rooms[room_id][0], {"type": "peer_joined", "initiator": True})
        await send_json(rooms[room_id][1], {"type": "peer_joined", "initiator": False})

    try:
        async for raw in ws:
            # Parse and relay signaling messages
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                log.warning("ignoring malformed message")
                continue

            msg_type = msg.get("type")
            if msg_type in ("offer", "answer", "ice_candidate"):
                other = get_other_peer(room_id, ws)
                if other is not None:
                    log.info("relay %s → other peer", msg_type)
                    await other.send(raw)
                else:
                    log.info("got %s but no other peer to relay to", msg_type)
            else:
                log.debug("ignoring message type: %s", msg_type)
    except websockets.ConnectionClosed:
        pass
    finally:
        # Clean up on disconnect
        if room_id in rooms:
            peers = rooms[room_id]
            if ws in peers:
                peers.remove(ws)
            remaining = len(peers)
            log.info("peer disconnected  (remaining=%d)", remaining)
            # Notify remaining peer
            for peer in peers:
                try:
                    await send_json(peer, {"type": "peer_left"})
                except websockets.ConnectionClosed:
                    pass
            # Delete empty room
            if not peers:
                log.info("room empty — deleted")
                del rooms[room_id]


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def process_request(connection, request: Request):
    """Serve static files for non-WebSocket requests."""
    if request.path.startswith("/ws/"):
        logging.info("WS  %s", request.path)
        return None  # Let WebSocket handler take over

    # Map URL path to file
    rel_path = request.path.lstrip("/")
    if not rel_path or rel_path.endswith("/"):
        rel_path = "index.html"

    file_path = STATIC_DIR / rel_path
    # Prevent directory traversal
    try:
        file_path = file_path.resolve()
        if not str(file_path).startswith(str(STATIC_DIR.resolve())):
            return Response(403, "Forbidden", websockets.Headers())
    except (ValueError, OSError):
        return Response(403, "Forbidden", websockets.Headers())

    if not file_path.is_file():
        logging.warning("404 %s", request.path)
        return Response(404, "Not Found", websockets.Headers())

    content_type = CONTENT_TYPES.get(file_path.suffix, "application/octet-stream")
    body = file_path.read_bytes()
    headers = websockets.Headers({
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
    })
    logging.info("200 %s (%s)", request.path, content_type.split(";")[0])
    return Response(200, "OK", headers, body)


async def main():
    async with websockets.serve(
        handler,
        HOST,
        PORT,
        process_request=process_request,
    ):
        print(f"MiniRTC server running on http://{HOST}:{PORT}")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
