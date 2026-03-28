const WS_URL = `ws://${location.hostname || "localhost"}:8765/ws`;

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// DOM elements
const landingEl = document.getElementById("landing");
const roomEl = document.getElementById("room");
const statusEl = document.getElementById("status");
const controlsEl = document.getElementById("controls");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const createRoomBtn = document.getElementById("create-room-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const muteBtn = document.getElementById("mute-btn");
const cameraBtn = document.getElementById("camera-btn");
const leaveBtn = document.getElementById("leave-btn");

// State
let ws = null;
let pc = null;
let localStream = null;
let roomId = null;
let isInitiator = false;
let audioMuted = false;
let videoOff = false;

// ── Routing ──────────────────────────────────────────────

function getRoomIdFromHash() {
  const hash = location.hash.slice(1);
  return hash || null;
}

function navigate() {
  roomId = getRoomIdFromHash();
  console.log("[router] navigate:", roomId ? `room=${roomId}` : "landing");
  if (roomId) {
    showRoom();
  } else {
    showLanding();
  }
}

window.addEventListener("hashchange", navigate);

// ── Views ────────────────────────────────────────────────

function showLanding() {
  cleanup();
  landingEl.hidden = false;
  roomEl.hidden = true;
}

function showRoom() {
  landingEl.hidden = true;
  roomEl.hidden = false;
  controlsEl.hidden = true;
  setStatus("Connecting...");
  connectSignaling();
}

function setStatus(text) {
  statusEl.textContent = text;
}

// ── Signaling (WebSocket) ────────────────────────────────

function connectSignaling() {
  if (ws) ws.close();

  ws = new WebSocket(`${WS_URL}/${roomId}`);

  ws.onopen = () => {
    console.log("[ws] connected, sending join");
    ws.send(JSON.stringify({ type: "join" }));
    setStatus("Waiting for peer...");
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log("[ws] received:", msg.type, msg);
    handleSignalingMessage(msg);
  };

  ws.onclose = (event) => {
    console.log("[ws] closed:", event.code, event.reason);
    setStatus("Disconnected");
  };

  ws.onerror = (err) => {
    console.error("[ws] error:", err);
    setStatus("Connection error — is the backend running on port 8765?");
  };
}

function sendSignaling(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function handleSignalingMessage(msg) {
  switch (msg.type) {
    case "peer_joined":
      isInitiator = msg.initiator;
      await startCall();
      break;

    case "offer":
      await handleOffer(msg.sdp);
      break;

    case "answer":
      await handleAnswer(msg.sdp);
      break;

    case "ice_candidate":
      await handleIceCandidate(msg.candidate);
      break;

    case "peer_left":
      handlePeerLeft();
      break;

    case "room_full":
      setStatus("Room is full");
      controlsEl.hidden = true;
      break;

    case "error":
      setStatus(`Error: ${msg.message}`);
      break;
  }
}

// ── WebRTC ───────────────────────────────────────────────

async function startCall() {
  setStatus("Connecting call...");
  controlsEl.hidden = false;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
  } catch (err) {
    // Fall back to audio-only if camera not available
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (err2) {
      setStatus("Microphone access required");
      return;
    }
  }

  localVideo.srcObject = localStream;

  createPeerConnection();

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  if (isInitiator) {
    console.log("[rtc] creating offer (I am initiator)");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignaling({ type: "offer", sdp: offer.sdp });
  } else {
    console.log("[rtc] waiting for offer (I am answerer)");
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling({
        type: "ice_candidate",
        candidate: event.candidate.toJSON(),
      });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    console.log("[rtc] connection state:", pc.connectionState);
    switch (pc.connectionState) {
      case "connected":
        setStatus("Connected");
        break;
      case "disconnected":
        setStatus("Peer disconnected");
        break;
      case "failed":
        setStatus("Connection failed");
        break;
    }
  };
}

async function handleOffer(sdp) {
  if (!pc) {
    // Second joiner: startCall was already called from peer_joined,
    // but if PC isn't ready yet, set up now
    await startCall();
  }

  await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignaling({ type: "answer", sdp: answer.sdp });
}

async function handleAnswer(sdp) {
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }
}

async function handleIceCandidate(candidate) {
  if (pc && candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function handlePeerLeft() {
  setStatus("Peer left");
  remoteVideo.srcObject = null;
  if (pc) {
    pc.close();
    pc = null;
  }
  // Keep local stream running — stay in room, wait for new peer
  setStatus("Waiting for peer...");
  controlsEl.hidden = true;
}

// ── Controls ─────────────────────────────────────────────

muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  audioMuted = !audioMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !audioMuted));
  muteBtn.textContent = audioMuted ? "Unmute" : "Mute";
  muteBtn.classList.toggle("muted", audioMuted);
});

cameraBtn.addEventListener("click", () => {
  if (!localStream) return;
  videoOff = !videoOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !videoOff));
  cameraBtn.textContent = videoOff ? "Camera On" : "Camera Off";
  cameraBtn.classList.toggle("muted", videoOff);
});

leaveBtn.addEventListener("click", () => {
  cleanup();
  location.hash = "";
});

copyLinkBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(location.href).then(() => {
    copyLinkBtn.textContent = "Copied!";
    setTimeout(() => (copyLinkBtn.textContent = "Copy Link"), 2000);
  });
});

createRoomBtn.addEventListener("click", () => {
  const id = crypto.randomUUID();
  console.log("[ui] creating room:", id);
  location.hash = id;
});

// ── Cleanup ──────────────────────────────────────────────

function cleanup() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  audioMuted = false;
  videoOff = false;
  muteBtn.textContent = "Mute";
  muteBtn.classList.remove("muted");
  cameraBtn.textContent = "Camera Off";
  cameraBtn.classList.remove("muted");
}

// ── Init ─────────────────────────────────────────────────

navigate();
