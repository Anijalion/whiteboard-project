const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

let pathsByRoom = {};
let locksByRoom = {};
let lastUsedTime = {};

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
// Socket.IO の maxHttpBufferSize を 100MB に設定
const io = new Server(server, { maxHttpBufferSize: 1e8 });

const AUTO_RESET_THRESHOLD = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const roomID in lastUsedTime) {
    if (now - lastUsedTime[roomID] > AUTO_RESET_THRESHOLD) {
      console.log(`[autoReset] ルーム "${roomID}" を24時間経過でリセット`);
      resetRoomData(roomID);
    }
  }
}, 60 * 60 * 1000);

function resetRoomData(roomID) {
  delete pathsByRoom[roomID];
  delete locksByRoom[roomID];
  delete lastUsedTime[roomID];
  io.to(roomID).emit("clearAll");
}
function updateLastUsed(roomID) {
  lastUsedTime[roomID] = Date.now();
}

io.on("connection", (socket) => {
  console.log("🟢 接続:", socket.id);

  socket.on("joinRoom", ({ roomID, userID, isTeacher }) => {
    socket.join(roomID);
    console.log(`[joinRoom] room=${roomID}, user=${userID}, isTeacher=${isTeacher}`);
    if (!pathsByRoom[roomID]) pathsByRoom[roomID] = {};
    if (!locksByRoom[roomID]) locksByRoom[roomID] = {};
    if (!lastUsedTime[roomID]) {
      lastUsedTime[roomID] = Date.now();
    } else {
      updateLastUsed(roomID);
    }
  });

  socket.on("syncPaths", ({ roomID, studentId, allPaths }) => {
    if (!pathsByRoom[roomID]) return;
    updateLastUsed(roomID);
    if (locksByRoom[roomID][studentId]) return;
    if (!pathsByRoom[roomID][studentId]) pathsByRoom[roomID][studentId] = {};
    pathsByRoom[roomID][studentId].paths = allPaths;
    socket.to(roomID).emit("syncPaths", { studentId, allPaths });
  });

  socket.on("syncPhotos", ({ roomID, studentId, photoObjs }) => {
    updateLastUsed(roomID);
    if (!pathsByRoom[roomID]) pathsByRoom[roomID] = {};
    if (!pathsByRoom[roomID][studentId]) pathsByRoom[roomID][studentId] = {};
    pathsByRoom[roomID][studentId].photos = photoObjs;
    socket.to(roomID).emit("syncPhotos", { studentId, photoObjs });
  });

  // 新規：syncLasso イベントのハンドリング
  socket.on("syncLasso", ({ roomID, studentId, selectRect }) => {
    updateLastUsed(roomID);
    if (!pathsByRoom[roomID]) pathsByRoom[roomID] = {};
    if (!pathsByRoom[roomID][studentId]) pathsByRoom[roomID][studentId] = {};
    pathsByRoom[roomID][studentId].selectRect = selectRect;
    socket.to(roomID).emit("syncLasso", { studentId, selectRect });
  });

  socket.on("clear", ({ roomID, targetId }) => {
    if (!pathsByRoom[roomID]) return;
    updateLastUsed(roomID);
    if (targetId === "ALL") {
      Object.keys(pathsByRoom[roomID]).forEach(studentId => {
        pathsByRoom[roomID][studentId] = {};
      });
      io.to(roomID).emit("clearAll");
    } else {
      if (!pathsByRoom[roomID][targetId]) return;
      pathsByRoom[roomID][targetId] = {};
      io.to(roomID).emit("clearOne", targetId);
    }
  });

  socket.on("getAllData", (roomID) => {
    if (!pathsByRoom[roomID]) {
      socket.emit("allData", {});
    } else {
      updateLastUsed(roomID);
      socket.emit("allData", pathsByRoom[roomID]);
    }
  });

  socket.on("getStudents", (roomID) => {
    if (!pathsByRoom[roomID]) {
      socket.emit("studentsList", []);
    } else {
      updateLastUsed(roomID);
      socket.emit("studentsList", Object.keys(pathsByRoom[roomID]));
    }
  });

  socket.on("lock", ({ roomID, studentId, locked }) => {
    if (!locksByRoom[roomID]) locksByRoom[roomID] = {};
    updateLastUsed(roomID);
    locksByRoom[roomID][studentId] = locked;
    io.to(roomID).emit("lockState", { studentId, locked });
    console.log(`[lock] room=${roomID}, student=${studentId}, locked=${locked}`);
  });

  socket.on("resetRoom", (roomID) => {
    console.log(`[resetRoom] room=${roomID}`);
    resetRoomData(roomID);
  });
});

// Render でデプロイする場合、process.env.PORT が自動的に設定されるのでそれを使います
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
});